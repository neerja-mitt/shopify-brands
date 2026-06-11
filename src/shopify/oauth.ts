/**
 * Shopify OAuth install flow (spec §4.3, Phase 0, steps 0.2–0.3).
 *
 * Public, UNLISTED app installed by link. Standard OAuth 2.0 authorization-code
 * flow (non-embedded — `embedded = false`). On a verified callback we exchange
 * the code for a permanent token, fetch the store's primary location, and
 * persist the merchant with the token encrypted at rest (handled by the
 * StoreRepository).
 *
 * Network calls (token exchange, location fetch) are injected so the
 * orchestration + verification are unit-testable without hitting Shopify. Live
 * HTTP implementations live at the bottom of this file.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { StoreRepository } from '../db/repositories.js';
import type { Store } from '../types/index.js';

/** Strict allow-list for shop domains — prevents SSRF via a forged `shop` param. */
const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export function isValidShopDomain(shop: string): boolean {
  return SHOP_DOMAIN_RE.test(shop);
}

/** Cryptographically-random anti-CSRF `state` nonce for the authorize step. */
export function generateState(): string {
  return randomBytes(16).toString('hex');
}

export interface AuthorizeUrlParams {
  shop: string;
  state: string;
  apiKey: string;
  scopes: string[];
  redirectUri: string;
}

/**
 * Build the authorize URL the merchant is redirected to (step 1). The caller
 * stores `state` (e.g. in a signed cookie/session) to check on callback.
 */
export function buildAuthorizeUrl(params: AuthorizeUrlParams): string {
  if (!isValidShopDomain(params.shop)) {
    throw new Error(`Invalid shop domain: ${params.shop}`);
  }
  const url = new URL(`https://${params.shop}/admin/oauth/authorize`);
  url.searchParams.set('client_id', params.apiKey);
  url.searchParams.set('scope', params.scopes.join(','));
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('state', params.state);
  return url.toString();
}

/**
 * Verify the HMAC on an OAuth callback (spec §4.3). Distinct from webhook HMAC:
 * Shopify signs the sorted query string (excluding `hmac`/`signature`) and the
 * digest is **hex**-encoded. Constant-time compare.
 */
export function verifyOAuthHmac(query: Record<string, string>, secret: string): boolean {
  const { hmac } = query;
  if (!hmac || !secret) return false;

  const message = Object.keys(query)
    .filter((k) => k !== 'hmac' && k !== 'signature')
    .sort()
    .map((k) => `${k}=${query[k]}`)
    .join('&');

  const computed = createHmac('sha256', secret).update(message).digest('hex');

  const expected = Buffer.from(computed, 'hex');
  let provided: Buffer;
  try {
    provided = Buffer.from(hmac, 'hex');
  } catch {
    return false;
  }
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

/** Exchanges an authorization code for a permanent access token. */
export interface TokenExchanger {
  exchange(shop: string, code: string): Promise<{ accessToken: string }>;
}

/** Fetches the store's primary location id (needs `read_locations`). */
export interface LocationFetcher {
  primaryLocationId(shop: string, accessToken: string): Promise<string>;
}

export interface CompleteInstallDeps {
  stores: StoreRepository;
  tokenExchanger: TokenExchanger;
  locationFetcher: LocationFetcher;
  /** App secret, for callback HMAC verification. */
  apiSecret: string;
  /** The `state` we issued at authorize time, to defend against CSRF. */
  expectedState: string;
}

/**
 * Handle the OAuth callback end-to-end (steps 0.2–0.3):
 * validate shop → check `state` → verify HMAC → exchange code → fetch primary
 * location → upsert the store (`active`, token encrypted by the repo). Returns
 * the persisted store (token in plaintext, in-memory only).
 *
 * Throws on any verification failure — nothing is persisted in that case.
 */
export async function completeInstall(
  query: Record<string, string>,
  deps: CompleteInstallDeps,
): Promise<Store> {
  const { shop, code, state } = query;

  if (!shop || !isValidShopDomain(shop)) {
    throw new Error('Invalid or missing shop domain');
  }
  if (!code) {
    throw new Error('Missing authorization code');
  }
  if (state !== deps.expectedState) {
    throw new Error('State mismatch — possible CSRF; aborting install');
  }
  if (!verifyOAuthHmac(query, deps.apiSecret)) {
    throw new Error('OAuth HMAC verification failed');
  }

  const { accessToken } = await deps.tokenExchanger.exchange(shop, code);
  const primaryLocationId = await deps.locationFetcher.primaryLocationId(shop, accessToken);

  const now = new Date();
  const store: Store = {
    shopDomain: shop,
    accessToken,
    primaryLocationId,
    status: 'active',
    installedAt: now,
    updatedAt: now,
  };
  await deps.stores.upsert(store);
  return store;
}

// ─────────────────────────────────────────────────────────────────────────────
// Live HTTP implementations (not unit-tested — exercised against a real store).
// ─────────────────────────────────────────────────────────────────────────────

/** Real token exchange against `POST https://{shop}/admin/oauth/access_token`. */
export class HttpTokenExchanger implements TokenExchanger {
  private readonly apiKey: string;
  private readonly apiSecret: string;

  constructor(apiKey: string, apiSecret: string) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  async exchange(shop: string, code: string): Promise<{ accessToken: string }> {
    if (!isValidShopDomain(shop)) throw new Error(`Invalid shop domain: ${shop}`);
    const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: this.apiKey,
        client_secret: this.apiSecret,
        code,
      }),
    });
    if (!res.ok) {
      throw new Error(`Token exchange failed: ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as { access_token?: string };
    if (!body.access_token) {
      throw new Error('Token exchange response missing access_token');
    }
    return { accessToken: body.access_token };
  }
}

/**
 * Fetches the primary location via the GraphQL Admin API. Stores it explicitly
 * (spec §4.3) — never hard-coded. Starts with the first location; multi-location
 * handling is layered on later (risk §8) without baking in the single-location
 * assumption elsewhere.
 */
export class GraphQLLocationFetcher implements LocationFetcher {
  private readonly apiVersion: string;

  constructor(apiVersion: string) {
    this.apiVersion = apiVersion;
  }

  async primaryLocationId(shop: string, accessToken: string): Promise<string> {
    if (!isValidShopDomain(shop)) throw new Error(`Invalid shop domain: ${shop}`);
    const res = await fetch(`https://${shop}/admin/api/${this.apiVersion}/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({
        query: `{ locations(first: 1) { edges { node { id } } } }`,
      }),
    });
    if (!res.ok) {
      throw new Error(`Location fetch failed: ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as {
      data?: { locations?: { edges?: Array<{ node?: { id?: string } }> } };
    };
    const id = body.data?.locations?.edges?.[0]?.node?.id;
    if (!id) {
      throw new Error('No location found for store (read_locations returned none)');
    }
    return id;
  }
}
