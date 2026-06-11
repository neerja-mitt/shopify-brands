/**
 * Shopify webhook handling (spec §4.4 / §4.5, Phase 0 + Phase 1).
 *
 * EVERY webhook MUST verify the Shopify HMAC signature before processing
 * (spec §4.5). Mandatory webhooks are required even while the app is unlisted.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import type { ProductMapRepository, StoreRepository } from '../db/repositories.js';
import { toShopifyStatus } from '../sync/catalogue.js';
import type { ShopifyGraphQLClient } from './client.js';
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
  productMap: ProductMapRepository;
}

/**
 * Dispatch a verified webhook (HMAC already checked by the caller). Routes by
 * topic; `payload` is the parsed JSON body.
 *
 * Note: webhook payloads carry NUMERIC ids, but we key the mapping table off
 * GraphQL global ids (gids). The handlers rebuild the gid deterministically
 * (`gid://shopify/<Type>/<numericId>`) before looking rows up.
 */
export async function dispatchWebhook(
  topic: string,
  shop: string,
  payload: unknown,
  deps: WebhookDeps,
): Promise<void> {
  switch (topic) {
    case 'app/uninstalled':
      // §6 step 18: stop selling stock we can no longer deduct.
      await deps.stores.setStatus(shop, 'inactive');
      return;

    case 'shop/redact':
      // §4.4 / Phase 4: erase the shop's data. For now mark inactive; a full
      // purge lands later.
      await deps.stores.setStatus(shop, 'inactive');
      console.log(`[webhook] shop/redact for ${shop} — marked inactive (purge pending)`);
      return;

    case 'customers/data_request':
    case 'customers/redact':
      // No customer scopes → we hold no customer PII. Acknowledged (§4.4).
      console.log(`[webhook] ${topic} for ${shop} — no customer data held`);
      return;

    case 'inventory_levels/update':
      await handleInventoryUpdate(shop, payload, deps);
      return;

    case 'products/update':
      await handleProductUpdate(shop, payload, deps);
      return;

    case 'products/delete':
      await handleProductDelete(shop, payload, deps);
      return;

    default:
      console.log(`[webhook] unhandled topic '${topic}' for ${shop}`);
  }
}

/** `inventory_levels/update` → refresh `last_synced_qty` for the variant (§4.5). */
async function handleInventoryUpdate(
  shop: string,
  payload: unknown,
  deps: WebhookDeps,
): Promise<void> {
  const p = payload as { inventory_item_id?: number | string; available?: number };
  if (p.inventory_item_id == null) return;
  const gid = `gid://shopify/InventoryItem/${p.inventory_item_id}`;
  const row = await deps.productMap.getByInventoryItem(shop, gid);
  if (!row) return;
  if (typeof p.available === 'number') row.lastSyncedQty = p.available;
  row.updatedAt = new Date();
  await deps.productMap.upsert(row);
}

/** `products/update` → refresh status + price for each known variant (§4.5). */
async function handleProductUpdate(
  shop: string,
  payload: unknown,
  deps: WebhookDeps,
): Promise<void> {
  const p = payload as {
    status?: string;
    variants?: Array<{ id?: number | string; price?: string }>;
  };
  if (!p.variants) return;
  const status = p.status ? toShopifyStatus(p.status) : undefined;
  for (const v of p.variants) {
    if (v.id == null) continue;
    const row = await deps.productMap.getByShopVariant(
      shop,
      `gid://shopify/ProductVariant/${v.id}`,
    );
    if (!row) continue; // a variant we don't track yet
    if (status) row.shopifyStatus = status;
    if (v.price !== undefined) row.lastSyncedPrice = Number(v.price);
    row.updatedAt = new Date();
    await deps.productMap.upsert(row);
  }
}

/** `products/delete` → hide the product's variants (§5.3 deleted → hidden). */
async function handleProductDelete(
  shop: string,
  payload: unknown,
  deps: WebhookDeps,
): Promise<void> {
  const p = payload as { id?: number | string };
  if (p.id == null) return;
  const productGid = `gid://shopify/Product/${p.id}`;
  for (const row of await deps.productMap.listByShop(shop)) {
    if (row.shopifyProductId !== productGid) continue;
    row.shopifyStatus = 'archived'; // hidden (no 'deleted' status on the row)
    row.updatedAt = new Date();
    await deps.productMap.upsert(row);
  }
}

// ── Registration ─────────────────────────────────────────────────────────────

/** Functional + lifecycle topics we subscribe each store to at install. */
const REGISTERED_TOPICS = [
  'APP_UNINSTALLED',
  'PRODUCTS_UPDATE',
  'PRODUCTS_DELETE',
  'INVENTORY_LEVELS_UPDATE',
] as const;

const SUBSCRIBE_MUTATION = `
mutation Subscribe($topic: WebhookSubscriptionTopic!, $url: URL!) {
  webhookSubscriptionCreate(topic: $topic, webhookSubscription: { callbackUrl: $url, format: JSON }) {
    userErrors { field message }
    webhookSubscription { id }
  }
}`;

interface SubscribeResult {
  webhookSubscriptionCreate: {
    userErrors: Array<{ field: string[] | null; message: string }>;
  };
}

export interface RegisterDeps {
  graphql: ShopifyGraphQLClient;
  /** Where Shopify should POST events, e.g. `${APP_URL}/webhooks/shopify`. */
  callbackUrl: string;
}

/**
 * Subscribe a freshly-installed store to our webhook topics (spec §4.4/§4.5).
 * Idempotent in effect: re-subscribing the same topic+URL returns a userError
 * we treat as "already registered" and ignore. Never throws — registration
 * failures are logged so they don't block the install.
 */
export async function registerWebhooks(store: Store, deps: RegisterDeps): Promise<void> {
  for (const topic of REGISTERED_TOPICS) {
    try {
      const data = await deps.graphql.query<SubscribeResult>(store, SUBSCRIBE_MUTATION, {
        topic,
        url: deps.callbackUrl,
      });
      const errors = data.webhookSubscriptionCreate.userErrors.filter(
        (e) => !/already/i.test(e.message), // ignore "already exists"
      );
      if (errors.length > 0) {
        console.error(`[webhook] register ${topic} for ${store.shopDomain}:`, errors);
      }
    } catch (err) {
      console.error(`[webhook] register ${topic} for ${store.shopDomain} failed:`, err);
    }
  }
}
