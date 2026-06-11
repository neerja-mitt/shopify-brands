/**
 * Application entry point / composition root.
 *
 * Wires concrete dependencies and starts the HTTP server. Adapter choice lives
 * here and nowhere else: Postgres when `DATABASE_URL` is set (migrations applied
 * on boot), otherwise the in-memory store (non-durable — dev/smoke only).
 */

import cron from 'node-cron';
import { Pool } from 'pg';

import { config } from './config/index.js';
import { reconcileAllStores, reportDrift } from './safety/reconcile.js';
import type { ProductMapRepository, StoreRepository } from './db/repositories.js';
import { InMemoryProductMapRepository, InMemoryStoreRepository } from './db/memory.js';
import { runMigrations } from './db/migrate.js';
import { PostgresProductMapRepository, PostgresStoreRepository } from './db/postgres.js';
import { createServer } from './http/server.js';
import { PerStoreRateLimitQueue, RateLimitedGraphQLClient } from './safety/rateLimitQueue.js';
import { HttpShopifyGraphQLClient, RetryingGraphQLClient } from './shopify/client.js';
import { GraphQLLocationFetcher, HttpTokenExchanger } from './shopify/oauth.js';

interface Repositories {
  stores: StoreRepository;
  productMap: ProductMapRepository;
}

async function buildRepositories(): Promise<Repositories> {
  if (config.databaseUrl) {
    const pool = new Pool({ connectionString: config.databaseUrl });
    await runMigrations(pool);
    console.log('[grape-shopify] Postgres connected; migrations applied.');
    return {
      stores: new PostgresStoreRepository(pool, config.tokenEncryptionKey),
      productMap: new PostgresProductMapRepository(pool),
    };
  }
  console.log(
    '[grape-shopify] WARNING: no DATABASE_URL — using in-memory store (data is NOT durable).',
  );
  return {
    stores: new InMemoryStoreRepository(config.tokenEncryptionKey),
    productMap: new InMemoryProductMapRepository(),
  };
}

async function main(): Promise<void> {
  const { stores, productMap } = await buildRepositories();
  const tokenExchanger = new HttpTokenExchanger(config.shopify.apiKey, config.shopify.apiSecret);
  const locationFetcher = new GraphQLLocationFetcher(config.shopify.apiVersion);
  // Funnel all Shopify GraphQL through a per-store rate-limit queue (§6 step 10).
  const rateLimitQueue = new PerStoreRateLimitQueue({
    minIntervalMs: config.rateLimit.minIntervalMs,
  });
  // Compose: per-store queue (outermost) → throttle retry → HTTP. Retries stay
  // inside a single queued slot so they don't jump ahead of other work.
  const graphql = new RateLimitedGraphQLClient(
    new RetryingGraphQLClient(new HttpShopifyGraphQLClient(config.shopify.apiVersion)),
    rateLimitQueue,
  );

  const server = createServer({
    config: {
      apiKey: config.shopify.apiKey,
      apiSecret: config.shopify.apiSecret,
      scopes: config.shopify.scopes,
      appUrl: config.appUrl,
      internalApiToken: config.internalApiToken,
    },
    stores,
    tokenExchanger,
    locationFetcher,
    productMap,
    graphql,
  });

  server.listen(config.port, () => {
    console.log(`[grape-shopify] listening on :${config.port} (env=${config.env})`);
  });

  // Nightly reconcile (spec §6 step 16). Re-baselines stock and flags drift.
  if (cron.validate(config.safety.reconcileCron)) {
    cron.schedule(config.safety.reconcileCron, async () => {
      console.log('[reconcile] starting sweep');
      const drift = await reconcileAllStores(stores, { graphql, maps: productMap });
      reportDrift(drift, config.safety.driftAlertDestination);
    });
    console.log(`[grape-shopify] reconcile scheduled: ${config.safety.reconcileCron}`);
  } else {
    console.error(`[grape-shopify] invalid RECONCILE_CRON: ${config.safety.reconcileCron}`);
  }
}

main().catch((err) => {
  console.error('[grape-shopify] fatal during startup:', err);
  process.exit(1);
});
