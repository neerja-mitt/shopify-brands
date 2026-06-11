/**
 * Shopify GraphQL Admin API client (spec §3 "API", Phase 1/2).
 *
 * GraphQL is chosen deliberately: one query pulls product + variants +
 * inventory + price together, cutting call count against rate limits (§8).
 * The client is an interface so callers (catalogue import, writeback) can be
 * unit-tested against canned responses; the live implementation uses `fetch`.
 */

import { isValidShopDomain } from './oauth.js';
import type { Store } from '../types/index.js';

export interface ShopifyGraphQLClient {
  /**
   * Run a GraphQL query/mutation against a store using its access token.
   * Returns the `data` payload (typed by the caller). Throws on transport or
   * GraphQL errors.
   */
  query<T>(store: Store, query: string, variables?: Record<string, unknown>): Promise<T>;
}

interface GraphQLEnvelope<T> {
  data?: T;
  errors?: unknown;
}

export class HttpShopifyGraphQLClient implements ShopifyGraphQLClient {
  private readonly apiVersion: string;

  constructor(apiVersion: string) {
    this.apiVersion = apiVersion;
  }

  async query<T>(
    store: Store,
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    if (!isValidShopDomain(store.shopDomain)) {
      throw new Error(`Invalid shop domain: ${store.shopDomain}`);
    }
    const res = await fetch(
      `https://${store.shopDomain}/admin/api/${this.apiVersion}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': store.accessToken,
        },
        body: JSON.stringify({ query, variables }),
      },
    );
    if (!res.ok) {
      throw new Error(`Shopify GraphQL HTTP ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as GraphQLEnvelope<T>;
    if (body.errors) {
      throw new Error(`Shopify GraphQL errors: ${JSON.stringify(body.errors)}`);
    }
    if (body.data === undefined) {
      throw new Error('Shopify GraphQL response missing data');
    }
    return body.data;
  }
}
