// Shopify Admin GraphQL via a Dev Dashboard app's client credentials.
// Env: SHOPIFY_SHOP (bronze-snake-1.myshopify.com), SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET.
import { q } from "./db";

const API_VERSION = "2025-10";
export const ONLINE_WAREHOUSE_ID = process.env.SHOPIFY_WAREHOUSE_LOCATION_ID || "gid://shopify/Location/38751305773";

let tokenCache: { token: string; exp: number } | null = null;

export function shopifyConfigured() {
  return !!(process.env.SHOPIFY_SHOP && process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET);
}

async function token(): Promise<string> {
  if (tokenCache && tokenCache.exp > Date.now()) return tokenCache.token;
  const shop = process.env.SHOPIFY_SHOP!;
  const body = new URLSearchParams({ client_id: process.env.SHOPIFY_CLIENT_ID!, client_secret: process.env.SHOPIFY_CLIENT_SECRET!, grant_type: "client_credentials" });
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } });
  const j = (await res.json()) as { access_token?: string; expires_in?: number; errors?: unknown };
  if (!j.access_token) throw new Error("Shopify token exchange failed: " + JSON.stringify(j).slice(0, 300));
  tokenCache = { token: j.access_token, exp: Date.now() + ((j.expires_in || 86400) - 300) * 1000 };
  return j.access_token;
}

export async function gql<T = unknown>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const shop = process.env.SHOPIFY_SHOP!;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Shopify-Access-Token": await token() },
      body: JSON.stringify({ query, variables }),
    });
    const j = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (j.errors?.some((e) => /throttl/i.test(e.message))) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
    if (j.errors) throw new Error(j.errors.map((e) => e.message).join("; ").slice(0, 500));
    return j.data as T;
  }
  throw new Error("Shopify throttled repeatedly");
}

export type VariantInfo = { barcode: string; variant_id: string; inventory_item_id: string; sku: string; product: string; size: string; colour: string };

function splitTitle(t: string): [string, string] {
  if (!t || t === "Default Title") return ["One size", ""];
  const p = t.split(" / ");
  return [p[0], p.length > 1 ? p.slice(1).join(" / ") : ""];
}

/** Barcode -> variant. Cached in the variants table; misses are looked up in Shopify 25 at a time. */
export async function resolveBarcodes(codes: string[]): Promise<Record<string, VariantInfo>> {
  const out: Record<string, VariantInfo> = {};
  if (!codes.length) return out;
  const cached = await q<VariantInfo>("SELECT barcode, variant_id, inventory_item_id, sku, product, size, colour FROM variants WHERE barcode = ANY($1)", [codes]);
  for (const v of cached) out[v.barcode] = v;
  const miss = codes.filter((c) => !out[c]);
  if (!miss.length || !shopifyConfigured()) return out;
  type R = { productVariants: { nodes: { id: string; sku: string | null; title: string; barcode: string | null; product: { title: string }; inventoryItem: { id: string } }[] } };
  for (let i = 0; i < miss.length; i += 25) {
    const chunk = miss.slice(i, i + 25);
    const query = chunk.map((c) => "barcode:" + c.replace(/[^A-Za-z0-9._-]/g, "")).join(" OR ");
    const d = await gql<R>(
      `query($q:String!){ productVariants(first:100, query:$q){ nodes{ id sku title barcode product{ title } inventoryItem{ id } } } }`,
      { q: query }
    );
    for (const v of d.productVariants.nodes) {
      const code = String(v.barcode || "").trim();
      if (!chunk.includes(code) || out[code]) continue;
      const [size, colour] = splitTitle(v.title);
      const info: VariantInfo = { barcode: code, variant_id: v.id, inventory_item_id: v.inventoryItem.id, sku: v.sku || "", product: v.product.title.replace(/ - FINAL SALE$/i, ""), size, colour };
      out[code] = info;
      await q(
        "INSERT INTO variants(barcode,variant_id,inventory_item_id,sku,product,size,colour,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()) ON CONFLICT(barcode) DO UPDATE SET variant_id=EXCLUDED.variant_id, inventory_item_id=EXCLUDED.inventory_item_id, sku=EXCLUDED.sku, product=EXCLUDED.product, size=EXCLUDED.size, colour=EXCLUDED.colour, updated_at=now()",
        [info.barcode, info.variant_id, info.inventory_item_id, info.sku, info.product, info.size, info.colour]
      );
    }
  }
  return out;
}

/** Make sure every item is stocked at the Online Warehouse (a store-only item has no level there yet). Activating adds a 0 level – nothing else. */
async function ensureStockedAtWarehouse(ids: string[]) {
  type R = { nodes: ({ id: string; inventoryLevel: { id: string } | null } | null)[] };
  const missing: string[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const d = await gql<R>(`query($ids:[ID!]!,$loc:ID!){ nodes(ids:$ids){ ... on InventoryItem { id inventoryLevel(locationId:$loc){ id } } } }`, { ids: ids.slice(i, i + 100), loc: ONLINE_WAREHOUSE_ID });
    for (const n of d.nodes) if (n && !n.inventoryLevel) missing.push(n.id);
  }
  for (const id of missing) {
    const d = await gql<{ inventoryActivate: { userErrors: { message: string }[] } }>(`mutation($id:ID!,$loc:ID!){ inventoryActivate(inventoryItemId:$id, locationId:$loc){ userErrors{ message } } }`, { id, loc: ONLINE_WAREHOUSE_ID });
    if (d.inventoryActivate.userErrors?.length) throw new Error("Could not stock item at Preston: " + d.inventoryActivate.userErrors.map((e) => e.message).join("; "));
  }
  return missing.length;
}

/** Add stock at the Online Warehouse. Relative adjustments only (+delta), never "set to". One atomic Shopify call. */
export async function receiveIntoWarehouse(lines: { inventory_item_id: string; qty: number }[], reference: string) {
  await ensureStockedAtWarehouse(lines.map((l) => l.inventory_item_id));
  type R = { inventoryAdjustQuantities: { userErrors: { field: string[] | null; message: string }[]; inventoryAdjustmentGroup: { id: string; createdAt: string } | null } };
  const changes = lines.map((l) => ({ inventoryItemId: l.inventory_item_id, locationId: ONLINE_WAREHOUSE_ID, delta: l.qty }));
  const d = await gql<R>(
    `mutation($input: InventoryAdjustQuantitiesInput!){ inventoryAdjustQuantities(input:$input){ userErrors{ field message } inventoryAdjustmentGroup{ id createdAt } } }`,
    { input: { name: "available", reason: "received", referenceDocumentUri: reference, changes } }
  );
  const r = d.inventoryAdjustQuantities;
  if (r.userErrors?.length) throw new Error(r.userErrors.map((e) => e.message).join("; "));
  return r.inventoryAdjustmentGroup?.id || "";
}

/** SKU -> variant (barcode, names). Cached variants table first, then Shopify 20 at a time. */
export async function resolveSkus(skus: string[]): Promise<Record<string, VariantInfo>> {
  const out: Record<string, VariantInfo> = {};
  const want = [...new Set(skus.filter(Boolean))];
  if (!want.length) return out;
  const cached = await q<VariantInfo>("SELECT barcode, variant_id, inventory_item_id, sku, product, size, colour FROM variants WHERE sku = ANY($1)", [want]);
  for (const v of cached) if (!out[v.sku]) out[v.sku] = v;
  const miss = want.filter((s) => !out[s]);
  if (!miss.length || !shopifyConfigured()) return out;
  type R = { productVariants: { nodes: { id: string; sku: string | null; title: string; barcode: string | null; product: { title: string }; inventoryItem: { id: string } }[] } };
  for (let i = 0; i < miss.length; i += 20) {
    const chunk = miss.slice(i, i + 20);
    const query = chunk.map((c) => `sku:"${c.replace(/["\\]/g, "")}"`).join(" OR ");
    const d = await gql<R>(`query($q:String!){ productVariants(first:100, query:$q){ nodes{ id sku title barcode product{ title } inventoryItem{ id } } } }`, { q: query });
    for (const v of d.productVariants.nodes) {
      const sku = (v.sku || "").trim(); if (!chunk.includes(sku) || out[sku]) continue;
      const [size, colour] = splitTitle(v.title);
      const info: VariantInfo = { barcode: String(v.barcode || "").trim(), variant_id: v.id, inventory_item_id: v.inventoryItem.id, sku, product: v.product.title.replace(/ - FINAL SALE$/i, ""), size, colour };
      out[sku] = info;
      if (info.barcode) await q(
        "INSERT INTO variants(barcode,variant_id,inventory_item_id,sku,product,size,colour,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()) ON CONFLICT(barcode) DO UPDATE SET variant_id=EXCLUDED.variant_id, inventory_item_id=EXCLUDED.inventory_item_id, sku=EXCLUDED.sku, product=EXCLUDED.product, size=EXCLUDED.size, colour=EXCLUDED.colour, updated_at=now()",
        [info.barcode, info.variant_id, info.inventory_item_id, info.sku, info.product, info.size, info.colour]);
    }
  }
  return out;
}
