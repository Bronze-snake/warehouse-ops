# Deploying ops.bronzesnake.com – one-time setup (about 40 minutes)

## 1. Shopify app "Warehouse Ops" (10 min)
1. Shopify admin → Settings → Apps and sales channels → Develop apps (Dev Dashboard) → **Create app** → name `Warehouse Ops`.
2. Configuration → Admin API access scopes: tick **read_products, read_inventory, write_inventory, read_locations**. Save.
3. Release / install the app on the store.
4. API credentials → copy the **Client ID** and **Client secret**. These go into Vercel as `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET`.

## 2. Database – Neon (5 min)
1. neon.tech → sign up (free) → New project → name `warehouse-ops`, region Sydney (ap-southeast-2).
2. Copy the **connection string** (starts `postgresql://…`). That is `DATABASE_URL`. Tables are created automatically on first use.

## 3. Code on GitHub (5 min)
1. github.com → New repository → `warehouse-ops`, private.
2. Unzip `warehouse-ops.zip` and upload the folder contents (drag and drop onto the repo page, or `git push` if you use git).

## 4. Vercel (10 min)
1. vercel.com → sign up with the GitHub account → **Add New Project** → import `warehouse-ops` → framework Next.js (auto) → before deploying, open **Environment Variables** and add:

| Name | Value |
| --- | --- |
| `SHOPIFY_SHOP` | `bronze-snake-1.myshopify.com` |
| `SHOPIFY_CLIENT_ID` | from step 1 |
| `SHOPIFY_CLIENT_SECRET` | from step 1 |
| `SHOPIFY_WAREHOUSE_LOCATION_ID` | `gid://shopify/Location/38751305773` |
| `DATABASE_URL` | from step 2 |
| `ACCESS_CODE` | the code staff will type (e.g. a 6-digit number) |
| `AUTH_SECRET` | any long random string (30+ characters) |
| `NEXT_PUBLIC_SITE_URL` | `https://ops.bronzesnake.com` |

2. Deploy. You get a `*.vercel.app` address that works immediately.
3. Project → Settings → Domains → add `ops.bronzesnake.com` → Vercel shows a CNAME record → add it at your DNS host (the same place the website's DNS lives). Live in ~10 minutes.

## 5. First use (5 min)
1. Open the site → sign in with your name + the access code.
2. **Admin → Location master** → upload Sean's latest ShipStation CSV.
3. **PUT AWAY** → upload `DEMO_SCAN_10_BARCODES.csv` → list should show 9 lines with bins + the 999999 dud in grey.
4. Build a real scan of **one** item → **Receive into Preston** → check Shopify → Products → that variant → Inventory history shows "+1, Received, reference ops.bronzesnake.com/putaway/N". Press Receive again on the same batch: it must refuse.
5. Tell the receiving team: Easy Scan is no longer the returns path. Scan → site → Receive → print → shelve.

## Updating later
Replace files in the GitHub repo (or push) → Vercel redeploys automatically in ~1 minute.

## If something breaks
- "Shopify isn't connected": one of the three SHOPIFY_* variables is missing or the app isn't installed/released.
- "Shopify refused the adjustment": the message shows Shopify's reason; nothing was changed. Usually a missing `write_inventory` scope – add it, release again.
- Lists all "Unknown barcode": Shopify variables OK but the barcode isn't on the variant in Shopify.
- Everything "No location": upload the location master.
