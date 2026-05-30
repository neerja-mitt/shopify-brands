/**
 * Shopify OAuth install flow (SCAFFOLD — spec §4.3, Phase 0).
 *
 * Standard OAuth 2.0 authorization-code flow for a public, UNLISTED app:
 * install is by link sent during manual onboarding. One credential set for all
 * merchants. On success we persist (per store): shop domain, ENCRYPTED access
 * token, primary location_id (fetched via read_locations), and status=active.
 *
 * No logic implemented yet — these are the contracts Phase 0 will fill in.
 */

import type { Store } from '../types/index.js';

/**
 * Build the Shopify authorize URL the merchant is redirected to (step 1 of the
 * code flow). Includes scopes (§4.2), the callback redirect, and an anti-CSRF
 * `state` nonce.
 */
export function buildAuthorizeUrl(_shopDomain: string): string {
  throw new Error('Not implemented (Phase 0): buildAuthorizeUrl');
}

/**
 * Handle the OAuth callback: verify HMAC + `state`, exchange the code for a
 * permanent access token, fetch the primary location via read_locations, then
 * persist the store with the token encrypted at rest.
 */
export async function handleCallback(_query: Record<string, string>): Promise<Store> {
  throw new Error('Not implemented (Phase 0): handleCallback');
}

/**
 * Register the mandatory + functional webhooks for a freshly installed store
 * (spec §4.4 / §4.5). Mandatory ones are required even while unlisted.
 */
export async function registerWebhooks(_store: Store): Promise<void> {
  throw new Error('Not implemented (Phase 0): registerWebhooks');
}
