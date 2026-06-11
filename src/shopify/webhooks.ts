/**
 * Shopify webhook handling (spec §4.4 / §4.5, Phase 0 + Phase 1).
 *
 * EVERY webhook MUST verify the Shopify HMAC signature before processing
 * (spec §4.5). Mandatory webhooks are required even while the app is unlisted.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import type { StoreRepository } from '../db/repositories.js';

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
export function verifyHmac(rawBody: Buffer, hmacHeader: string, secret: string): boolean {
  if (!hmacHeader || !secret) {
    return false;
  }

  // Shopify signs the RAW request body with the app secret, base64-encoded.
  const computed = createHmac('sha256', secret).update(rawBody).digest('base64');

  const expected = Buffer.from(computed, 'base64');
  let provided: Buffer;
  try {
    provided = Buffer.from(hmacHeader, 'base64');
  } catch {
    return false;
  }

  // Constant-time compare; bail early if lengths differ (timingSafeEqual throws otherwise).
  if (expected.length !== provided.length) {
    return false;
  }
  return timingSafeEqual(expected, provided);
}

export interface WebhookDeps {
  stores: StoreRepository;
}

/**
 * Dispatch a verified webhook (HMAC already checked by the caller). Routes by
 * topic. Implemented now: lifecycle/compliance. Functional product/inventory
 * topics are logged pending their Phase 1 handlers.
 */
export async function dispatchWebhook(
  topic: string,
  shop: string,
  deps: WebhookDeps,
): Promise<void> {
  switch (topic) {
    case 'app/uninstalled':
      // §6 step 18: stop selling stock we can no longer deduct. Mark inactive
      // immediately; catalogue-hide follows once sync is wired.
      await deps.stores.setStatus(shop, 'inactive');
      return;

    case 'shop/redact':
      // §4.4 / Phase 4: erase the shop's data. For now mark inactive; a full
      // purge lands with the Postgres adapter.
      await deps.stores.setStatus(shop, 'inactive');
      console.log(`[webhook] shop/redact for ${shop} — marked inactive (purge pending)`);
      return;

    case 'customers/data_request':
    case 'customers/redact':
      // We request no customer scopes, so we hold no customer PII — nothing to
      // return or delete. Acknowledged for compliance (§4.4).
      console.log(`[webhook] ${topic} for ${shop} — no customer data held`);
      return;

    case 'products/update':
    case 'products/delete':
    case 'inventory_levels/update':
      // TODO Phase 1 (§4.5): keep Grape's catalogue current in near-real-time.
      console.log(`[webhook] ${topic} for ${shop} — handler pending (Phase 1)`);
      return;

    default:
      console.log(`[webhook] unhandled topic '${topic}' for ${shop}`);
  }
}
