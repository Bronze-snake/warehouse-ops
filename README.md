# Bronze Snake – Warehouse Ops

Internal site for the Preston warehouse. Phase 1: **Put away** (scan → list in bin order → receive into Preston).

- Next.js 15 (App Router), plain CSS, no AI at runtime.
- Postgres on Neon in production (`DATABASE_URL`); in-memory Postgres (PGlite) when that variable is absent, for local testing.
- Shopify via a Dev Dashboard app's client credentials (`SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET`), scopes `read_products, read_inventory, write_inventory`.
- Sign-in: shared access code (`ACCESS_CODE`) + the person's name, kept in a signed cookie; the name is written on every batch.

See `DEPLOY.md` for the one-time setup and `.env.example` for the variables.

## Local run
```
npm install
ACCESS_CODE=test123 DEV_SEED=1 npm run dev
```
Without Shopify credentials the barcode cache is empty, so POST a few rows to `/api/dev/seed` (dev only) or set the Shopify variables.
