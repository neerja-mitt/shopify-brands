# Shopify App Setup — Runbook (Phase 0, step 0.1)

How to create the Shopify app and get the credentials this codebase needs. This
is the one step that lives **outside the repo** (in Shopify's Partner dashboard)
and produces the secrets you'll paste into `.env`.

**What we're creating:** a single **public app**, left **unlisted** (never
submitted for App Store review), installed by a link we send each merchant. One
credential set serves all merchants. See SPEC §3–§4.

> "Unlisted" isn't a toggle — it just means *a public app you don't submit to
> the App Store*. You build a public app and distribute the install link
> manually. No review needed.

URL conventions used below (all derived from `APP_URL` in `.env`):

| Purpose | Path | Example (local dev) |
|---|---|---|
| App URL | `/` | `https://localhost:3000` |
| OAuth redirect / callback | `/auth/callback` | `https://localhost:3000/auth/callback` |
| Webhook endpoint | `/webhooks/shopify` | `https://localhost:3000/webhooks/shopify` |

> For local testing, Shopify must reach your callback over HTTPS — use a tunnel
> (e.g. `cloudflared tunnel` or `ngrok http 3000`) and set `APP_URL` to the
> tunnel's HTTPS URL, not `localhost`.

---

## Prerequisites

1. A **Shopify Partner account** → sign up / log in at <https://partners.shopify.com>.
   You'll be inside a Partner **organization**.
2. A **development store** for testing (free, no real billing):
   Partner dashboard → **Stores → Add store → Create development store**. Add a
   couple of products with variants + stock so there's something to sync.

---

## Path A — Partner Dashboard (recommended; matches the spec)

1. **Create the app**
   Partner dashboard → **Apps → Create app → Create app manually**.
   Name it (e.g. `Grape Merchant Sync`). This generates the app with a
   **Client ID** (= `SHOPIFY_API_KEY`) and **Client secret** (= `SHOPIFY_API_SECRET`).

2. **Copy the credentials** → into `.env`:
   ```
   SHOPIFY_API_KEY=<Client ID>
   SHOPIFY_API_SECRET=<Client secret>
   ```
   Never commit `.env` (it's gitignored).

3. **Configure URLs** (app → **Configuration**):
   - **App URL:** `https://<your-host>`
   - **Allowed redirection URL(s):** `https://<your-host>/auth/callback`
   - **Embedded app:** **OFF.** We do **not** embed in Shopify admin — our UI is
     the standalone Grape portal (SPEC §2). This matters: it changes the OAuth
     flow (no App Bridge / session tokens).

4. **Scopes** — we request these at OAuth time (they're in `SHOPIFY_SCOPES`):
   `read_products`, `read_inventory`, `write_inventory`, `read_locations`.
   **No order scopes, ever** (SPEC §4.2). Products/inventory/locations are **not**
   "protected customer data", so the protected-data approval flow doesn't apply.

5. **Compliance (GDPR) webhooks** — required even while unlisted (SPEC §4.4).
   In **Configuration → Compliance webhooks**, set all three to your webhook
   endpoint:
   - Customer data request → `https://<your-host>/webhooks/shopify`
   - Customer data erasure → `https://<your-host>/webhooks/shopify`
   - Shop data erasure → `https://<your-host>/webhooks/shopify`
   (We verify HMAC and route by the `X-Shopify-Topic` header — one endpoint is fine.)

6. **API version** — pin to `2025-01` (matches `SHOPIFY_API_VERSION`). Bump
   deliberately, not automatically.

7. **Leave it unlisted** — do **not** click "Submit for review" / don't start
   App Store distribution. Done.

That's step 0.1 complete. The remaining functional webhooks
(`products/update`, `products/delete`, `inventory_levels/update`) are registered
**programmatically at install** by our code (Phase 0, step 0.4) — you don't set
those in the dashboard.

---

## Path B — Config as code (optional, via Shopify CLI)

If you'd rather keep the app config version-controlled instead of hand-set in
the dashboard, use the CLI and the checked-in [`shopify.app.toml`](../shopify.app.toml):

```bash
npm i -g @shopify/cli @shopify/app   # one-time
shopify app config link              # links the toml to the app, fills client_id
shopify app deploy                   # pushes scopes + webhook config to Shopify
```

`shopify.app.toml` already encodes the scopes, redirect URL, `embedded = false`,
and the compliance webhook endpoint. After `config link`, commit the populated
`client_id` (it's not a secret — the **secret** stays only in `.env`).

---

## Installing on a store (the "install by link")

Each merchant installs by visiting an OAuth authorize URL (this is the link we
send during onboarding):

```
https://<shop>.myshopify.com/admin/oauth/authorize
  ?client_id=<SHOPIFY_API_KEY>
  &scope=read_products,read_inventory,write_inventory,read_locations
  &redirect_uri=https://<your-host>/auth/callback
  &state=<random-nonce>
```

Shopify shows the merchant a consent screen → on approve, it calls our
`/auth/callback`, where our code (Phase 0, step 0.2–0.3) exchanges the code for a
token, fetches the primary location, and stores the merchant encrypted. For
testing you can also use the **"Select store / Install"** button on the app's
**Overview** page in the Partner dashboard to install on your dev store.

---

## Verification checklist

- [ ] App created; `SHOPIFY_API_KEY` + `SHOPIFY_API_SECRET` are in `.env`.
- [ ] App URL + `/auth/callback` redirect URL configured.
- [ ] Embedded app is **OFF**.
- [ ] Three GDPR compliance webhooks point at `/webhooks/shopify`.
- [ ] API version is `2025-01`.
- [ ] App is **unlisted** (not submitted for review).
- [ ] A development store exists with a few products to sync.

Once these are ticked, 0.1 is done and we can build the OAuth callback (0.2) that
consumes these values.
