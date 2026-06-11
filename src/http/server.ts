/**
 * HTTP server (Phase 0 wiring).
 *
 * Exposes the endpoints Shopify and ops need:
 *   GET  /health           — liveness probe (Railway healthcheck)
 *   GET  /auth?shop=…       — start OAuth install (redirect to Shopify consent)
 *   GET  /auth/callback     — finish OAuth: verify, exchange, persist, sync
 *   GET  /sync?shop=…       — re-run catalogue import for an installed store
 *   POST /webhooks/shopify  — verified webhook receiver
 *
 * Built on node:http (no framework) so we control the RAW request body, which
 * webhook HMAC verification requires. Dependencies are injected so the server
 * is testable without real Shopify calls.
 */

import http from 'node:http';

import type { ProductMapRepository, StoreRepository } from '../db/repositories.js';
import type { ShopifyGraphQLClient } from '../shopify/client.js';
import {
  buildAuthorizeUrl,
  completeInstall,
  generateState,
  isValidShopDomain,
  type LocationFetcher,
  type TokenExchanger,
} from '../shopify/oauth.js';
import { dispatchWebhook, verifyHmac } from '../shopify/webhooks.js';
import { importCatalogue } from '../sync/catalogue.js';
import type { Store } from '../types/index.js';

export interface ServerConfig {
  apiKey: string;
  apiSecret: string;
  scopes: string[];
  /** Public base URL (e.g. the Railway domain). Callback = `${appUrl}/auth/callback`. */
  appUrl: string;
}

export interface ServerDeps {
  config: ServerConfig;
  stores: StoreRepository;
  tokenExchanger: TokenExchanger;
  locationFetcher: LocationFetcher;
  productMap: ProductMapRepository;
  graphql: ShopifyGraphQLClient;
}

const STATE_COOKIE = 'grape_oauth_state';

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function readRawBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res: http.ServerResponse, status: number, body: string, headers: http.OutgoingHttpHeaders = {}): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(body);
}

/** Run the catalogue import for a store, logging the outcome. Never throws. */
function runImport(store: Store, deps: ServerDeps): Promise<void> {
  return importCatalogue(store, { graphql: deps.graphql, maps: deps.productMap })
    .then((r) => {
      console.log(`[sync] ${store.shopDomain}: imported ${r.products} products / ${r.variants} variants`);
    })
    .catch((e: unknown) => {
      console.error(`[sync] ${store.shopDomain}: import failed —`, e);
    });
}

export function createServer(deps: ServerDeps): http.Server {
  const { config } = deps;
  const redirectUri = `${config.appUrl.replace(/\/$/, '')}/auth/callback`;

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const { pathname } = url;

      // ── Health ───────────────────────────────────────────────────────────
      if (req.method === 'GET' && pathname === '/health') {
        return send(res, 200, 'ok');
      }

      // ── Start install ────────────────────────────────────────────────────
      if (req.method === 'GET' && pathname === '/auth') {
        const shop = url.searchParams.get('shop') ?? '';
        if (!isValidShopDomain(shop)) {
          return send(res, 400, 'Invalid or missing ?shop=<store>.myshopify.com');
        }
        const state = generateState();
        const authorizeUrl = buildAuthorizeUrl({
          shop,
          state,
          apiKey: config.apiKey,
          scopes: config.scopes,
          redirectUri,
        });
        // Store the nonce in an httpOnly cookie to check on callback (CSRF guard).
        return send(res, 302, '', {
          Location: authorizeUrl,
          'Set-Cookie': `${STATE_COOKIE}=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
        });
      }

      // ── Finish install ───────────────────────────────────────────────────
      if (req.method === 'GET' && pathname === '/auth/callback') {
        const cookies = parseCookies(req.headers.cookie);
        const expectedState = cookies[STATE_COOKIE];
        if (!expectedState) {
          return send(res, 400, 'Missing OAuth state cookie (start at /auth)');
        }
        const query = Object.fromEntries(url.searchParams.entries());
        try {
          const store = await completeInstall(query, {
            stores: deps.stores,
            tokenExchanger: deps.tokenExchanger,
            locationFetcher: deps.locationFetcher,
            apiSecret: config.apiSecret,
            expectedState,
          });
          // Kick off the initial catalogue import in the background — don't make
          // the merchant wait on it before the redirect (§6 step 6).
          void runImport(store, deps);
          // Clear the state cookie; send the merchant to the app.
          return send(res, 302, '', {
            Location: config.appUrl,
            'Set-Cookie': `${STATE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
          });
        } catch (err) {
          // Verification/exchange failure — nothing was persisted.
          return send(res, 400, `Install failed: ${(err as Error).message}`);
        }
      }

      // ── Manual re-sync (testing / ops) ───────────────────────────────────
      if (req.method === 'GET' && pathname === '/sync') {
        const shop = url.searchParams.get('shop') ?? '';
        if (!isValidShopDomain(shop)) {
          return send(res, 400, 'Invalid or missing ?shop=<store>.myshopify.com');
        }
        const store = await deps.stores.get(shop);
        if (!store || store.status !== 'active') {
          return send(res, 404, 'Store not installed or not active');
        }
        const result = await importCatalogue(store, {
          graphql: deps.graphql,
          maps: deps.productMap,
        });
        return send(res, 200, JSON.stringify(result), {
          'Content-Type': 'application/json; charset=utf-8',
        });
      }

      // ── Webhooks ─────────────────────────────────────────────────────────
      if (req.method === 'POST' && pathname === '/webhooks/shopify') {
        const rawBody = await readRawBody(req);
        const hmacHeader = String(req.headers['x-shopify-hmac-sha256'] ?? '');
        if (!verifyHmac(rawBody, hmacHeader, config.apiSecret)) {
          return send(res, 401, 'HMAC verification failed');
        }
        const topic = String(req.headers['x-shopify-topic'] ?? '');
        const shop = String(req.headers['x-shopify-shop-domain'] ?? '');
        // Process, then ack. Handlers here are fast (status flips / logs).
        await dispatchWebhook(topic, shop, { stores: deps.stores });
        return send(res, 200, 'ok');
      }

      return send(res, 404, 'Not found');
    } catch (err) {
      return send(res, 500, `Internal error: ${(err as Error).message}`);
    }
  });
}
