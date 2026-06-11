/**
 * Schema migration runner (spec §5.1).
 *
 * Applies the canonical DDL ({@link SCHEMA_SQL}). The statements are all
 * idempotent (`CREATE TABLE/INDEX IF NOT EXISTS`), so running this on every boot
 * is safe and converges the database to the expected shape. A real migration
 * tool (versioned up/down) can replace this once schemas start evolving.
 */

import { SCHEMA_SQL } from './schema.js';

/** Minimal query surface satisfied by `pg.Pool`/`pg.Client` (and pg-mem). */
export interface Queryable {
  query(text: string): Promise<unknown>;
}

export async function runMigrations(db: Queryable): Promise<void> {
  await db.query(SCHEMA_SQL);
}
