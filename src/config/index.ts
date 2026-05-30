/**
 * Centralised, validated configuration (SCAFFOLD).
 *
 * Reads from environment (see `.env.example`). Keeping this in one place means
 * the rest of the codebase never touches `process.env` directly.
 */

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    // In scaffold stage we warn rather than throw, so the skeleton runs without
    // real credentials. Flip to `throw` once the app does real work.
    console.warn(`[config] Missing required env var: ${name}`);
    return '';
  }
  return value;
}

function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: optionalInt('PORT', 3000),
  appUrl: process.env.APP_URL ?? 'https://localhost:3000',

  shopify: {
    apiKey: required('SHOPIFY_API_KEY'),
    apiSecret: required('SHOPIFY_API_SECRET'),
    // Scopes per spec §4.2 — NO order scopes, ever.
    scopes: (process.env.SHOPIFY_SCOPES ??
      'read_products,read_inventory,write_inventory,read_locations')
      .split(',')
      .map((s) => s.trim()),
    apiVersion: process.env.SHOPIFY_API_VERSION ?? '2025-01',
  },

  /** 32-byte hex key used to encrypt Shopify tokens at rest (spec §4.3). */
  tokenEncryptionKey: required('TOKEN_ENCRYPTION_KEY'),

  databaseUrl: required('DATABASE_URL'),

  safety: {
    // Don't sell Shopify's last unit (spec §5.2 / §6 step 17).
    oversellBufferDefault: optionalInt('OVERSELL_BUFFER_DEFAULT', 2),
    reconcileCron: process.env.RECONCILE_CRON ?? '0 3 * * *',
    driftAlertDestination: process.env.DRIFT_ALERT_DESTINATION ?? '',
  },
} as const;

export type Config = typeof config;
