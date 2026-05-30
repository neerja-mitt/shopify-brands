/**
 * Shopify webhook handling (SCAFFOLD — spec §4.4 / §4.5, Phase 0 + Phase 1).
 *
 * EVERY webhook MUST verify the Shopify HMAC signature before processing
 * (spec §4.5). Mandatory webhooks are required even while the app is unlisted.
 */

import type { Store } from '../types/index.js';

/** Webhook topics we subscribe to (spec §4.4 mandatory + §4.5 functional). */
export type WebhookTopic =
  // Mandatory (§4.4)
  | 'app/uninstalled'
  | 'customers/data_request' // GDPR
  | 'customers/redact' // GDPR
  | 'shop/redact' // GDPR
  // Functional, fast-follow (§4.5)
  | 'products/update'
  | 'products/delete'
  | 'inventory_levels/update';

/**
 * Verify the `X-Shopify-Hmac-Sha256` header against the raw request body using
 * the app secret. Returns true only on a constant-time match. Reject otherwise
 * — no processing happens on an unverified payload.
 */
export function verifyHmac(_rawBody: Buffer, _hmacHeader: string): boolean {
  throw new Error('Not implemented (Phase 0): verifyHmac');
}

/**
 * Dispatch a verified webhook to its handler. `app/uninstalled` → mark the
 * store inactive and hide its catalogue immediately (§6 step 18); product /
 * inventory topics → keep Grape current in near-real-time (§4.5).
 */
export async function dispatchWebhook(
  _topic: WebhookTopic,
  _store: Store,
  _payload: unknown,
): Promise<void> {
  throw new Error('Not implemented (Phase 0/1): dispatchWebhook');
}
