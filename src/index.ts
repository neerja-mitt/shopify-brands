/**
 * Application entry point / composition root.
 *
 * Wires concrete dependencies and starts the HTTP server. Adapter choice lives
 * here and nowhere else: Postgres when `DATABASE_URL` is set (migrations applied
 * on boot), otherwise the in-memory store (non-durable — dev/smoke only).
 */

import { Pool } from 'pg';

import { config } from './config/index.js';
import type { ProductMapRepository, StoreRepository } from './db/repositories.js';
import { InMemoryProductMapRepository, InMemoryStoreRepository } from './db/memory.js';
import { runMigrations } from './db/migrate.js';
import { PostgresProductMapRepository, PostgresStoreRepository } from './db/postgres.js';
import { createServer } from './http/server.js';
import { HttpShopifyGraphQLClient } from './shopify/client.js';
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
  const graphql = new HttpShopifyGraphQLClient(config.shopify.apiVersion);

  const server = createServer({
    config: {
      apiKey: config.shopify.apiKey,
      apiSecret: config.shopify.apiSecret,
      scopes: config.shopify.scopes,
      appUrl: config.appUrl,
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
}

main().catch((err) => {
  console.error('[grape-shopify] fatal during startup:', err);
  process.exit(1);
});
