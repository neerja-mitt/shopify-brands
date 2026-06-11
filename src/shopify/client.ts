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
  errors?: Array<{ message?: string; extensions?: { code?: string } }>;
}

/** Thrown when Shopify rejects a query for rate-limiting — the caller may retry. */
export class ShopifyThrottledError extends Error {
  constructor(message = 'Shopify GraphQL throttled') {
    super(message);
    this.name = 'ShopifyThrottledError';
  }
}

function isThrottled(errors: GraphQLEnvelope<unknown>['errors']): boolean {
  return !!errors?.some((e) => e.extensions?.code === 'THROTTLED');
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
      if (isThrottled(body.errors)) {
        throw new ShopifyThrottledError();
      }
      throw new Error(`Shopify GraphQL errors: ${JSON.stringify(body.errors)}`);
    }
    if (body.data === undefined) {
      throw new Error('Shopify GraphQL response missing data');
    }
    return body.data;
  }
}

/**
 * Decorator that retries on {@link ShopifyThrottledError} with exponential
 * backoff (spec §6 step 12: "retry on rate-limit, respect throttle"). Other
 * errors pass straight through. Compose this INSIDE the rate-limit queue so a
 * retry doesn't jump ahead of other queued work.
 */
export class RetryingGraphQLClient implements ShopifyGraphQLClient {
  private readonly inner: ShopifyGraphQLClient;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    inner: ShopifyGraphQLClient,
    options: { maxRetries?: number; baseDelayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
  ) {
    this.inner = inner;
    this.maxRetries = options.maxRetries ?? 4;
    this.baseDelayMs = options.baseDelayMs ?? 500;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async query<T>(store: Store, query: string, variables?: Record<string, unknown>): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.inner.query<T>(store, query, variables);
      } catch (err) {
        if (!(err instanceof ShopifyThrottledError) || attempt >= this.maxRetries) {
          throw err;
        }
        await this.sleep(this.baseDelayMs * 2 ** attempt); // 500, 1000, 2000, …
        attempt += 1;
      }
    }
  }
}
