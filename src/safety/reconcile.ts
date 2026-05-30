/**
 * Nightly reconcile (SCAFFOLD — spec §6 Phase 4, step 16).
 *
 * The backstop for missed webhooks and manual RTO add-backs. Per store: pull
 * current Shopify stock, re-baseline `last_synced_qty`, and flag drift between
 * Grape's expectation and Shopify's actual to the alert destination.
 */

import type { Store } from '../types/index.js';

export interface DriftReport {
  shopDomain: string;
  shopifyVariantId: string;
  grapeExpectedQty: number;
  shopifyActualQty: number;
}

/**
 * Reconcile a single store: re-baseline quantities and return any drift rows.
 * Scheduled via RECONCILE_CRON (config / `.env`).
 */
export async function reconcileStore(_store: Store): Promise<DriftReport[]> {
  throw new Error('Not implemented (Phase 4): reconcileStore');
}

/** Send flagged drift to the configured alert destination (open item §9). */
export async function reportDrift(_reports: DriftReport[]): Promise<void> {
  throw new Error('Not implemented (Phase 4): reportDrift');
}
