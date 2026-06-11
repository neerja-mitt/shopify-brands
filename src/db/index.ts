/**
 * Persistence layer (spec §5) — barrel.
 *
 * The app depends on the repository ports; pick a concrete adapter at the
 * composition root. In-memory for tests/scaffold, Postgres for production.
 * Schema: `schema.sql`.
 */

export type { ProductMapRepository, StoreRepository } from './repositories.js';
export { InMemoryProductMapRepository, InMemoryStoreRepository } from './memory.js';
export { PostgresProductMapRepository, PostgresStoreRepository } from './postgres.js';
