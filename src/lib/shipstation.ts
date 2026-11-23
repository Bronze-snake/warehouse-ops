// ShipStation API v2 (api.shipstation.com). Env: SHIPSTATION_API_KEY.
// Read: pending shipments (= orders awaiting shipment). Write: ONLY adds a tag to shipments we put in a wave. Nothing else is ever changed.
const BASE = "https://api.shipstation.com/v2";

export function shipstationConfigured() { return !!process.env.SHIPSTATION_API_KEY; }

async function ss<T>(path: string, init: RequestInit = {}): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(BASE + path, { ...init, headers: { "api-key": process.env.SHIPSTATION_API_KEY!, "content-type": "application/json", ...(init.headers || {}) } });
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
    const text = await res.text();
    if (!res.ok) throw new Error(`ShipStation ${res.status} on ${path}: ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : null) as T;
  }
  throw new Error("ShipStation rate-limited repeatedly");
}

export type SSItem = { sku: string; name: string; quantity: number; external_order_item_id: string | null; bin?: string };
export type SSShipment = { shipment_id: string; shipment_number: string; external_order_id: string | null; created_at: string; ship_to_name: string; tags: string[]; items: SSItem[]; warehouse_id: string | null; service_code: string | null; carrier_id: string | null; carrier: string; units: number };

type Raw = { shipment_id: string; shipment_number: string | null; external_shipment_id: string | null; external_order_id: string | null; created_at: string; shipment_status: string; warehouse_id: string | null; service_code: string | null; carrier_id: string | null; ship_to: { name: string | null } | null; tags: { name: string }[]; items: { sku: string | null; name: string | null; quantity: number; external_order_item_id: string | null }[] };

/** Orders awaiting shipment, oldest first. Skips anything whose tags match `skip` (default: already in a wave). */
export async function listPending(max = 600, skip: RegExp = /^WAVE-/i): Promise<SSShipment[]> {
  const out: SSShipment[] = [];
  const carriers = await carrierNames();
  for (let page = 1; page <= 25 && out.length < max; page++) {
    const d = await ss<{ shipments: Raw[]; pages: number; total: number }>(`/shipments?shipment_status=pending&sort_by=created_at&sort_dir=asc&page_size=100&page=${page}`);
    for (const r of d.shipments || []) {
      const tags = (r.tags || []).map((t) => t.name);
      if (tags.some((t) => skip.test(t))) continue;
      const items = (r.items || []).filter((i) => i.quantity > 0).map((i) => ({ sku: (i.sku || "").trim(), name: i.name || "", quantity: i.quantity, external_order_item_id: i.external_order_item_id }));
      out.push({ shipment_id: r.shipment_id, shipment_number: r.shipment_number || r.external_shipment_id || r.external_order_id || r.shipment_id, external_order_id: r.external_order_id, created_at: r.created_at, ship_to_name: r.ship_to?.name || "", tags, items, warehouse_id: r.warehouse_id, service_code: r.service_code, carrier_id: r.carrier_id, carrier: carrierLabel(r.carrier_id, r.service_code, carriers), units: items.reduce((a, i) => a + i.quantity, 0) });
    }
    if (!d.pages || page >= d.pages) break;
  }
  return out;
}

let carrierCache: { at: number; map: Record<string, string> } | null = null;
/** carrier_id -> friendly name (cached for an hour). */
export async function carrierNames(): Promise<Record<string, string>> {
  if (carrierCache && Date.now() - carrierCache.at < 3600e3) return carrierCache.map;
  const map: Record<string, string> = {};
  try {
    const d = await ss<{ carriers: { carrier_id: string; friendly_name: string | null; carrier_code: string }[] }>("/carriers");
    for (const c of d.carriers || []) map[c.carrier_id] = c.friendly_name || c.carrier_code;
  } catch {}
  carrierCache = { at: Date.now(), map };
  return map;
}
/** A short label for grouping: the carrier's name, or a guess from the service code, or "No carrier" when no service is set yet. */
export function carrierLabel(carrierId: string | null, serviceCode: string | null, names: Record<string, string>) {
  if (carrierId && names[carrierId]) return names[carrierId];
  const sc = (serviceCode || "").toLowerCase();
  if (!sc && !carrierId) return "No carrier";
  if (/auspost|australia_post|au_post/.test(sc)) return "Australia Post";
  if (/dhl/.test(sc)) return "DHL";
  if (/sendle/.test(sc)) return "Sendle";
  if (/startrack/.test(sc)) return "StarTrack";
  if (/aramex|fastway/.test(sc)) return "Aramex";
  if (/couriers_please|couriersplease/.test(sc)) return "CouriersPlease";
  return carrierId || sc.split("_")[0] || "No carrier";
}

/** Tag shipments with the wave name so they are not picked twice. Creates the tag if it doesn't exist. */
export async function tagShipments(ids: string[], tag: string): Promise<{ tagged: number; failed: string[] }> {
  const tags = await ss<{ tags: { name: string }[] }>("/tags");
  if (!tags.tags?.some((t) => t.name === tag)) await ss(`/tags/${encodeURIComponent(tag)}`, { method: "POST" });
  const failed: string[] = []; let tagged = 0;
  for (const id of ids) {
    try { await ss(`/shipments/${id}/tags/${encodeURIComponent(tag)}`, { method: "POST" }); tagged++; }
    catch { failed.push(id); }
  }
  return { tagged, failed };
}

/** Remove one tag (only ever our own BATCH-* / WAVE-* tags). */
export async function untagShipments(ids: string[], tag: string): Promise<number> {
  let n = 0;
  for (const id of ids) { try { await ss(`/shipments/${id}/tags/${encodeURIComponent(tag)}`, { method: "DELETE" }); n++; } catch {} }
  return n;
}

/** Lookup by order number (the barcode on the packing slip). */
export async function findByNumber(num: string): Promise<SSShipment | null> {
  const d = await ss<{ shipments: Raw[] }>(`/shipments?shipment_number=${encodeURIComponent(num)}&page_size=5`);
  const r = (d.shipments || [])[0]; if (!r) return null;
  const items = (r.items || []).map((i) => ({ sku: (i.sku || "").trim(), name: i.name || "", quantity: i.quantity, external_order_item_id: i.external_order_item_id }));
  return { shipment_id: r.shipment_id, shipment_number: r.shipment_number || num, external_order_id: r.external_order_id, created_at: r.created_at, ship_to_name: r.ship_to?.name || "", tags: (r.tags || []).map((t) => t.name), items, warehouse_id: r.warehouse_id, service_code: r.service_code, carrier_id: r.carrier_id, carrier: carrierLabel(r.carrier_id, r.service_code, await carrierNames()), units: items.reduce((a, i) => a + i.quantity, 0) };
}
