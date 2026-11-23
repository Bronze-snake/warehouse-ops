// ShipStation API v1 (ssapi.shipstation.com) – the one that works on ORDERS (what the Orders grid shows).
// Env: SHIPSTATION_V1_KEY + SHIPSTATION_V1_SECRET (Settings → Account → API Settings → API Key / API Secret).
// Reads: orders awaiting shipment, the account's tag list. Writes: add / remove a tag on an order. Nothing else.
// Rate limit is 40 requests/minute, so tagging is paced and done in chunks from the browser.
import type { SSShipment } from "./shipstation";

const BASE = "https://ssapi.shipstation.com";
export function v1Configured() { return !!(process.env.SHIPSTATION_V1_KEY && process.env.SHIPSTATION_V1_SECRET); }

async function v1<T>(path: string, init: RequestInit = {}): Promise<T> {
  const auth = Buffer.from(`${process.env.SHIPSTATION_V1_KEY}:${process.env.SHIPSTATION_V1_SECRET}`).toString("base64");
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(BASE + path, { ...init, headers: { Authorization: "Basic " + auth, "content-type": "application/json", ...(init.headers || {}) } });
    if (res.status === 429) { const wait = Number(res.headers.get("x-rate-limit-reset") || 10); await new Promise((r) => setTimeout(r, Math.min(60, wait + 1) * 1000)); continue; }
    const text = await res.text();
    if (!res.ok) throw new Error(`ShipStation ${res.status} on ${path}: ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : null) as T;
  }
  throw new Error("ShipStation rate-limited repeatedly");
}

export type V1Tag = { tagId: number; name: string; color: string };
let tagCache: { at: number; tags: V1Tag[] } | null = null;
export async function listTags(force = false): Promise<V1Tag[]> {
  if (!force && tagCache && Date.now() - tagCache.at < 600e3) return tagCache.tags;
  const tags = await v1<V1Tag[]>("/accounts/listtags");
  tagCache = { at: Date.now(), tags: tags || [] };
  return tagCache.tags;
}

type V1Order = {
  orderId: number; orderNumber: string; orderKey: string; orderDate: string; createDate: string; orderStatus: string;
  shipTo: { name: string | null } | null; carrierCode: string | null; serviceCode: string | null; requestedShippingService: string | null;
  tagIds: number[] | null; items: { sku: string | null; name: string | null; quantity: number; adjustment: boolean; warehouseLocation: string | null }[];
};

const CARRIER_NAMES: Record<string, string> = { auspost: "Australia Post", australia_post: "Australia Post", dhl_express: "DHL Express", dhl_express_au: "DHL Express", dhl_ecommerce: "DHL eCommerce", seko: "SEKO", seko_omnichannel: "SEKO Omni-Channel", sendle: "Sendle", startrack: "StarTrack", aramex: "Aramex", fastway: "Aramex", couriers_please: "CouriersPlease", tnt: "TNT", fedex: "FedEx", ups: "UPS", stamps_com: "USPS" };
function carrierName(code: string | null) {
  if (!code) return "No carrier";
  if (CARRIER_NAMES[code]) return CARRIER_NAMES[code];
  return code.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Orders awaiting shipment, oldest first, with tag NAMES resolved. `skip` drops orders carrying a matching tag. */
export async function listAwaiting(max = 3000, skip: RegExp = /^$/): Promise<SSShipment[]> {
  const tags = await listTags();
  const byId: Record<number, string> = {}; for (const t of tags) byId[t.tagId] = t.name;
  const out: SSShipment[] = [];
  for (let page = 1; page <= 10 && out.length < max; page++) {
    const d = await v1<{ orders: V1Order[]; total: number; page: number; pages: number }>(`/orders?orderStatus=awaiting_shipment&pageSize=500&page=${page}&sortBy=OrderDate&sortDir=ASC`);
    for (const o of d.orders || []) {
      const names = (o.tagIds || []).map((id) => byId[id]).filter(Boolean);
      if (names.some((t) => skip.test(t))) continue;
      const items = (o.items || []).filter((i) => !i.adjustment && i.quantity > 0).map((i) => ({ sku: (i.sku || "").trim(), name: i.name || "", quantity: i.quantity, external_order_item_id: null as string | null, bin: (i.warehouseLocation || "").trim() }));
      out.push({ shipment_id: String(o.orderId), shipment_number: o.orderNumber, external_order_id: o.orderKey, created_at: o.orderDate || o.createDate, ship_to_name: o.shipTo?.name || "", tags: names, items, warehouse_id: null, service_code: o.serviceCode || o.requestedShippingService, carrier_id: o.carrierCode, carrier: carrierName(o.carrierCode), units: items.reduce((a, i) => a + i.quantity, 0) });
    }
    if (!d.pages || page >= d.pages) break;
  }
  return out;
}

/** Tag id for a name, or null if the account doesn't have that tag (v1 can't create tags). */
export async function tagIdFor(name: string): Promise<number | null> {
  const t = (await listTags()).find((x) => x.name.toLowerCase() === name.toLowerCase()) || (await listTags(true)).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return t ? t.tagId : null;
}

/** Add one tag to one order. ~1.5 s pacing keeps us under 40/min. */
export async function addTag(orderId: number, tagId: number) {
  await v1(`/orders/addtag`, { method: "POST", body: JSON.stringify({ orderId, tagId }) });
}
export async function removeTag(orderId: number, tagId: number) {
  await v1(`/orders/removetag`, { method: "POST", body: JSON.stringify({ orderId, tagId }) });
}
export const PACE_MS = 1600;
