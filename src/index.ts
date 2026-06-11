/**
 * Application entry point / composition root.
 *
 * Wires concrete dependencies and starts the HTTP server. Adapter choice lives
 * here and nowhere else.
 *
 * NOTE (persistence): the Postgres adapter isn't implemented yet, so we boot
 * with the in-memory store repository. That's enough to prove OAuth + webhooks
 * end-to-end, but data does NOT survive a restart — wiring the Postgres adapter
 * is the next infra step before anything relies on durable storage.
 */

import { config } from './config/index.js';
import { InMemoryStoreRepository } from './db/memory.js';
import { createServer } from './http/server.js';
import { GraphQLLocationFetcher, HttpTokenExchanger } from './shopify/oauth.js';

function main(): void {
  const stores = new InMemoryStoreRepository(config.tokenEncryptionKey);
  const tokenExchanger = new HttpTokenExchanger(config.shopify.apiKey, config.shopify.apiSecret);
  const locationFetcher = new GraphQLLocationFetcher(config.shopify.apiVersion);

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
  });

  server.listen(config.port, () => {
    console.log(`[grape-shopify] listening on :${config.port} (env=${config.env})`);
    console.log('[grape-shopify] WARNING: in-memory store — data is not durable until Postgres is wired.');
  });
}

main();
