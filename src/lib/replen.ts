import { q } from "./db";
import { gql, ONLINE_WAREHOUSE_ID } from "./shopify";

export type ReplenLine = { sku: string; product: string; size: string; colour: string; dept: string; units: number; orders: number; bin: string; variant_id: string };
export type Window = { start: Date; end: Date; label: string };

export const TZ = "Australia/Melbourne";
// Melbourne wall-clock -> Date. Works out the zone offset for that day (handles AEST/AEDT).
export function melb(y: number, m: number, d: number, h: number, min = 0): Date {
  const guess = new Date(Date.UTC(y, m - 1, d, h, min));
  const parts = new Intl.DateTimeFormat("en-AU", { timeZone: TZ, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(guess);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asIf = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
  return new Date(guess.getTime() - (asIf - guess.getTime()));
}
export function ymd(d: Date) { const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d); const [y, m, dd] = p.split("-").map(Number); return { y, m, d: dd }; }
function dow(d: Date) { return new Intl.DateTimeFormat("en-AU", { timeZone: TZ, weekday: "short" }).format(d); }

/** Sean's window for a report run on `runDay` (Melbourne). Mon: Fri 3pm → Mon 7am. Tue–Fri: previous day 3pm → run day 7am. Sat/Sun: treated like Monday's rule is not needed – use previous day 3pm → 7am. */
export function windowFor(runDay: Date = new Date()): Window {
  const { y, m, d } = ymd(runDay);
  const end = melb(y, m, d, 7);
  const back = dow(runDay) === "Mon" ? 3 : 1;
  const s = new Date(end.getTime() - back * 864e5);
  const sp = ymd(s);
  const start = melb(sp.y, sp.m, sp.d, 15);
  const f = (x: Date) => new Intl.DateTimeFormat("en-AU", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(x);
  return { start, end, label: `${f(start)} → ${f(end)}` };
}

type OrderNode = {
  id: string; name: string;
  lineItems: { nodes: { id: string; quantity: number; sku: string | null; variantTitle: string | null; title: string; variant: { id: string; product: { title: string; tags: string[] } } | null }[] };
  fulfillmentOrders: { nodes: { assignedLocation: { location: { id: string } | null }; lineItems: { nodes: { totalQuantity: number; lineItem: { id: string } }[] } }[] };
};

/** Units sold from the Online Warehouse in the window, grouped by variant, highest first, with bins. */
export async function buildReplen(win: Window): Promise<{ lines: ReplenLine[]; orders: number; scanned: number }> {
  const query = `created_at:>='${win.start.toISOString()}' created_at:<'${win.end.toISOString()}' financial_status:paid -status:cancelled`;
  const agg: Record<string, ReplenLine & { orderIds: Set<string> }> = {};
  let after: string | null = null, scanned = 0, matched = 0;
  for (let page = 0; page < 80; page++) {
    const d: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: OrderNode[] } } = await gql(
      `query($q:String!,$after:String){ orders(first:25, after:$after, query:$q){ pageInfo{ hasNextPage endCursor } nodes{ id name
        lineItems(first:60){ nodes{ id quantity sku variantTitle title variant{ id product{ title tags } } } }
        fulfillmentOrders(first:10){ nodes{ assignedLocation{ location{ id } } lineItems(first:60){ nodes{ totalQuantity lineItem{ id } } } } } } } }`,
      { q: query, after }
    );
    for (const o of d.orders.nodes) {
      scanned++;
      // line item ids that are assigned to the Online Warehouse
      const whQty: Record<string, number> = {};
      for (const fo of o.fulfillmentOrders.nodes) {
        if (fo.assignedLocation?.location?.id !== ONLINE_WAREHOUSE_ID) continue;
        for (const li of fo.lineItems.nodes) whQty[li.lineItem.id] = (whQty[li.lineItem.id] || 0) + li.totalQuantity;
      }
      if (!Object.keys(whQty).length) continue;
      matched++;
      for (const li of o.lineItems.nodes) {
        const units = whQty[li.id]; if (!units || !li.variant) continue;
        const key = li.variant.id;
        if (!agg[key]) {
          const [size, colour] = splitTitle(li.variantTitle || "");
          const tags = li.variant.product.tags || [];
          const dept = tags.includes("Mens") || li.variant.product.title.startsWith("Unisex") ? "Mens" : tags.includes("Womens") ? "Womens" : "";
          agg[key] = { variant_id: key, sku: li.sku || "", product: li.variant.product.title.replace(/ - FINAL SALE$/i, ""), size, colour, dept, units: 0, orders: 0, bin: "", orderIds: new Set() };
        }
        agg[key].units += units; agg[key].orderIds.add(o.id);
      }
    }
    if (!d.orders.pageInfo.hasNextPage) break;
    after = d.orders.pageInfo.endCursor;
  }
  const lines = Object.values(agg).map((l) => ({ ...l, orders: l.orderIds.size }));
  const skus = lines.map((l) => l.sku).filter(Boolean);
  const bins = skus.length ? await q<{ sku: string; bin: string }>("SELECT sku, bin FROM bins WHERE sku = ANY($1)", [skus]) : [];
  const bmap: Record<string, string> = {}; for (const b of bins) bmap[b.sku] = b.bin;
  for (const l of lines) l.bin = bmap[l.sku] || "";
  lines.sort((a, b) => b.units - a.units || a.product.localeCompare(b.product));
  return { lines: lines.map(({ orderIds, ...rest }) => { void orderIds; return rest; }), orders: matched, scanned };
}

function splitTitle(t: string): [string, string] {
  if (!t || t === "Default Title") return ["One size", ""];
  const p = t.split(" / "); return [p[0], p.length > 1 ? p.slice(1).join(" / ") : ""];
}
