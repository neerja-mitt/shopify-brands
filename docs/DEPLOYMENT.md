# Deployment

## Where this runs — and why

**Now: Railway. Later: AWS.**

Grape runs its core platform on **AWS** and its MVPs on **Railway**. This
integration is an MVP today, so it starts on **Railway** and graduates to AWS
when it's proven and needs to sit inside the core platform's security boundary.

Why Railway fits the MVP stage:
- Always-on service (webhooks, nightly reconcile, rate-limit queue all need a
  process that's up), **managed Postgres**, **automatic HTTPS + public domain**,
  cron, and env-var secrets — no ops setup.
- The Railway public domain **replaces a dev tunnel**: we point Shopify's app
  URLs straight at it and install against that.

Why not AWS yet: this service talks to Shopify (external) and to Grape's order
APIs **over HTTPS regardless of host**, and its own data (the mapping table) is
self-contained. Co-locating with AWS buys ops overhead without a real coupling
benefit at MVP stage. It's built host-agnostic (config via env vars), so the
Railway → AWS move is a redeploy, not a rewrite.

> Cross-host note for later: order-confirmed → inventory writeback and
> portal-status → Grape are normal cross-host HTTPS calls to Grape's AWS APIs.
> They'll need a shared auth token / allow-list between the Railway service and
> those endpoints. Not a blocker for Phase 0.

## What's deployed

A single Node service (`Dockerfile` → `node dist/index.js`) exposing:

| Route | Purpose |
|---|---|
| `GET /health` | Railway healthcheck |
| `GET /auth?shop=…` | Start OAuth install |
| `GET /auth/callback` | Finish OAuth (verify, exchange, persist) |
| `POST /webhooks/shopify` | HMAC-verified webhook receiver |

Build/deploy config: `Dockerfile`, `.dockerignore`, `railway.json`
(healthcheck `/health`, restart-on-failure).

> **Persistence:** with `DATABASE_URL` set, the service uses the Postgres
> adapter and applies the schema migration on boot (idempotent). Without it (no
> `DATABASE_URL`), it falls back to a non-durable in-memory store and logs a
> warning — fine for a local smoke test, not for real data. So: add the Railway
> Postgres (step 2) and the service persists installs automatically.

## First deploy — steps

1. **Create the Railway project** and link this repo (Railway → New Project →
   Deploy from GitHub repo → pick `shopify-brands`). It auto-detects the
   `Dockerfile`.
2. **Add Postgres** (Railway → New → Database → PostgreSQL). Railway sets
   `DATABASE_URL` on the service automatically.
3. **Set environment variables** on the service (Railway → Variables):

   | Variable | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `SHOPIFY_API_KEY` | the app's Client ID |
   | `SHOPIFY_API_SECRET` | the app's Client secret (from the password manager) |
   | `SHOPIFY_SCOPES` | `read_products,read_inventory,write_inventory,read_locations` |
   | `SHOPIFY_API_VERSION` | `2026-04` |
   | `TOKEN_ENCRYPTION_KEY` | 32-byte hex — generate with `openssl rand -hex 32` |
   | `APP_URL` | the Railway public domain (set after first deploy) |
   | `DATABASE_URL` | (auto-set by Railway Postgres) |

   `PORT` is injected by Railway — don't set it.
4. **Deploy.** Railway builds the Dockerfile and starts the service. Confirm the
   public domain responds at `/health`.
5. **Point Shopify at the Railway domain** (Dev Dashboard → app config):
   - App URL → `https://<railway-domain>`
   - Redirect URL → `https://<railway-domain>/auth/callback`
   - Compliance webhooks → `https://<railway-domain>/webhooks/shopify`
   Release the new app version, then update `APP_URL` to match and redeploy.
6. **Install on the dev store:** visit
   `https://<railway-domain>/auth?shop=<your-dev-store>.myshopify.com` and
   approve. The callback completes the install.

## Secrets

Never commit secrets. In production they live only in **Railway Variables**. For
local development, copy `.env.example` → `.env` (gitignored) and fill it in.
