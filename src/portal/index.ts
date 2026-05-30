/**
 * Grape Merchant portal — standalone web app (SCAFFOLD — spec §6 Phase 3).
 *
 * Our stack, our design system (DM Sans; brand purple #7C3AED as accent only;
 * black as the primary CTA). This is NOT embedded in Shopify admin — no App
 * Bridge / Polaris (spec §2). Merchants only VIEW Grape orders and mark them
 * processed/shipped; they never manage orders inside Shopify.
 *
 * Auth method is an open item (§9): email/password vs magic link — TBD.
 */

/** A Grape order as shown to the merchant (spec §6 step 14). */
export interface PortalOrder {
  grapeOrderId: string;
  /** Prepaid → Grape already collected payment; COD → merchant collects on delivery. */
  paymentType: 'prepaid' | 'cod';
  /** For COD rows only: the amount the merchant must collect on delivery. */
  codCollectAmount: number | null;
  status: 'new' | 'processed' | 'shipped';
}

/** List Grape orders for the authenticated merchant. */
export async function listOrders(_merchantId: string): Promise<PortalOrder[]> {
  throw new Error('Not implemented (Phase 3): listOrders');
}

/**
 * Mark an order processed/shipped. Writes back to Grape order state, which then
 * surfaces the status to the Grape customer (spec §6 step 15).
 */
export async function updateOrderStatus(
  _grapeOrderId: string,
  _status: 'processed' | 'shipped',
): Promise<void> {
  throw new Error('Not implemented (Phase 3): updateOrderStatus');
}
