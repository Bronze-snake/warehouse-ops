// Store pick list – same rules as the Store Replen Google Sheet, computed here from Shopify.
// A "run" = one store + one sales window. Lines are what to pull from Preston. Picking is confirmed by scan
// (or a manual override) and shared across phones because it lives in the database, not the browser.
import { q } from "./db";
import { gql, ONLINE_WAREHOUSE_ID } from "./shopify";
import { binSort, sizeIdx } from "./putaway";
import { melb, ymd, TZ } from "./replen";

export const STORES = [
  { key: "f", name: "Fitzroy", locId: "gid://shopify/Location/46987509805", nosend: "nosendf" },
  { key: "p", name: "Prahran", locId: "gid://shopify/Location/46987542573", nosend: "nosendp" },
  { key: "g", name: "Glenelg", locId: "gid://shopify/Location/46987575341", nosend: "nosendg" },
  { key: "n", name: "Newtown", locId: "gid://shopify/Location/79190261805", nosend: "nosendn" },
] as const;
export type StoreKey = (typeof STORES)[number]["key"];
const MIN_WAREHOUSE = 5;      // leave the last few for online
const MAX_DISCOUNT = 0.30;    // 30%+ off is not sent to stores

export type PickLine = {
  id: number; run_id: number; variant_id: string; sku: string; barcode: string; product: string; size: string; colour: string; dept: string; bin: string;
  sold: number; store_stock: number; wh_stock: number; pick: number; picked: number; picked_by: string | null; picked_at: string | null; method: string | null;
};
export type PickRun = {
  id: number; store_key: string; store: string; start: string; end: string; label: string; created_at: string; created_by: string;
  status: string; finished_at: string | null; finished_by: string | null; lines: number; units: number; removed: number;
};
export type Removed = { product: string; size: string; colour: string; sku: string; sold: number; reason: string };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS pick_runs (
  id serial PRIMARY KEY, store_key text NOT NULL, store text NOT NULL, "start" timestamptz NOT NULL, "end" timestamptz NOT NULL, label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'open',
  finished_at timestamptz, finished_by text, lines integer NOT NULL DEFAULT 0, units integer NOT NULL DEFAULT 0, removed integer NOT NULL DEFAULT 0, removed_json text NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS pick_lines (
  id serial PRIMARY KEY, run_id integer NOT NULL REFERENCES pick_runs(id) ON DELETE CASCADE,
  variant_id text NOT NULL, sku text NOT NULL DEFAULT '', barcode text NOT NULL DEFAULT '', product text NOT NULL, size text NOT NULL DEFAULT '', colour text NOT NULL DEFAULT '',
  dept text NOT NULL DEFAULT '', bin text NOT NULL DEFAULT '', sold integer NOT NULL, store_stock integer NOT NULL, wh_stock integer NOT NULL, pick integer NOT NULL,
  picked integer NOT NULL DEFAULT 0, picked_by text, picked_at timestamptz, method text
);
CREATE INDEX IF NOT EXISTS pick_lines_run ON pick_lines(run_id);
CREATE TABLE IF NOT EXISTS sent_log (
  id serial PRIMARY KEY, store text NOT NULL, sent_date date NOT NULL, sku text NOT NULL DEFAULT '', product text NOT NULL, size text NOT NULL DEFAULT '', colour text NOT NULL DEFAULT '',
  qty integer NOT NULL, run_id integer, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sent_log_store_date ON sent_log(store, sent_date);
`;
let schemaReady: Promise<void> | null = null;
async function ensure() {
  if (!schemaReady) schemaReady = (async () => { for (const s of SCHEMA.split(";").map((x) => x.trim()).filter(Boolean)) await q(s); })();
  await schemaReady;
}

/** Whole Melbourne days: from/to as YYYY-MM-DD (inclusive). Defaults: Monday → Fri–Sun, any other day → yesterday. */
export function rangeFor(from?: string | null, to?: string | null, today = new Date()): { start: Date; end: Date; label: string; from: string; to: string } {
  const parse = (s: string) => { const [y, m, d] = s.split("-").map(Number); return melb(y, m, d, 0); };
  let f: string, t: string;
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) { f = from; t = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : from; }
  else {
    const { y, m, d } = ymd(today);
    const midnight = melb(y, m, d, 0);
    const dow = new Intl.DateTimeFormat("en-AU", { timeZone: TZ, weekday: "short" }).format(today);
    const back = dow === "Mon" ? 3 : 1;
    const iso = (x: Date) => { const p = ymd(x); return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`; };
    f = iso(new Date(midnight.getTime() - back * 864e5)); t = iso(new Date(midnight.getTime() - 864e5));
  }
  if (t < f) [f, t] = [t, f];
  const start = parse(f), end = new Date(parse(t).getTime() + 864e5);
  const fm = (x: Date) => new Intl.DateTimeFormat("en-AU", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" }).format(x);
  const label = f === t ? fm(start) : `${fm(start)} – ${fm(parse(t))}`;
  return { start, end, label, from: f, to: t };
}

function splitTitle(t: string): [string, string] { if (!t || t === "Default Title") return ["One size", ""]; const p = t.split(" / "); return [p[0], p.length > 1 ? p.slice(1).join(" / ") : ""]; }

type Sold = Record<string, number>; // variant id -> units

async function posSales(store: (typeof STORES)[number], start: Date, end: Date): Promise<{ sold: Sold; orderIds: Set<string> }> {
  const query = `source_name:pos created_at:>='${start.toISOString()}' created_at:<'${end.toISOString()}' -status:cancelled`;
  const sold: Sold = {}; const orderIds = new Set<string>(); let after: string | null = null;
  type R = { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: { id: string; retailLocation: { id: string } | null; lineItems: { nodes: { quantity: number; variant: { id: string } | null }[] } }[] } };
  for (let page = 0; page < 60; page++) {
    const d: R = await gql(`query($q:String!,$after:String){ orders(first:100, query:$q, after:$after){ pageInfo{hasNextPage endCursor} nodes{ id retailLocation{id} lineItems(first:60){ nodes{ quantity variant{id} } } } } }`, { q: query, after });
    for (const o of d.orders.nodes) {
      if (o.retailLocation?.id !== store.locId) continue;
      orderIds.add(o.id);
      for (const li of o.lineItems.nodes) if (li.variant) sold[li.variant.id] = (sold[li.variant.id] || 0) + li.quantity;
    }
    if (!d.orders.pageInfo.hasNextPage) break; after = d.orders.pageInfo.endCursor;
  }
  return { sold, orderIds };
}

/** Online orders the store itself fulfilled (ship-from-store / click & collect) count as store sales too. */
async function storeFulfilled(store: (typeof STORES)[number], start: Date, end: Date, skip: Set<string>, sold: Sold) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(start);
  const query = `assigned_location_id:${store.locId.split("/").pop()} updated_at:>=${day}`;
  let after: string | null = null;
  type R = { fulfillmentOrders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: { order: { id: string }; fulfillments: { nodes: { status: string; createdAt: string; location: { id: string } | null; fulfillmentLineItems: { nodes: { quantity: number; lineItem: { variant: { id: string } | null } }[] } }[] } }[] } };
  for (let page = 0; page < 60; page++) {
    const d: R = await gql(`query($q:String!,$after:String){ fulfillmentOrders(first:50, includeClosed:true, query:$q, after:$after){ pageInfo{hasNextPage endCursor} nodes{ order{id} fulfillments(first:10){ nodes{ status createdAt location{id} fulfillmentLineItems(first:60){ nodes{ quantity lineItem{ variant{id} } } } } } } } }`, { q: query, after });
    for (const fo of d.fulfillmentOrders.nodes) {
      if (skip.has(fo.order.id)) continue;
      for (const f of fo.fulfillments.nodes) {
        if (f.status !== "SUCCESS" || f.location?.id !== store.locId) continue;
        const c = new Date(f.createdAt); if (c < start || c >= end) continue;
        for (const fl of f.fulfillmentLineItems.nodes) { const v = fl.lineItem.variant; if (v) sold[v.id] = (sold[v.id] || 0) + fl.quantity; }
      }
    }
    if (!d.fulfillmentOrders.pageInfo.hasNextPage) break; after = d.fulfillmentOrders.pageInfo.endCursor;
  }
}

type VDetail = { sku: string; barcode: string; title: string; price: string; compareAtPrice: string | null; product: { title: string; productType: string; tags: string[]; status: string }; store: number; wh: number };
async function variantDetails(ids: string[], store: (typeof STORES)[number]): Promise<Record<string, VDetail>> {
  const out: Record<string, VDetail> = {};
  type N = { id: string; sku: string | null; barcode: string | null; title: string; price: string; compareAtPrice: string | null; product: VDetail["product"]; inventoryItem: { s: { quantities: { quantity: number }[] } | null; w: { quantities: { quantity: number }[] } | null } } | null;
  const qty = (x: { quantities: { quantity: number }[] } | null) => x?.quantities?.[0]?.quantity ?? 0;
  for (let i = 0; i < ids.length; i += 100) {
    const d: { nodes: N[] } = await gql(
      `query($ids:[ID!]!,$s:ID!,$w:ID!){ nodes(ids:$ids){ ... on ProductVariant{ id sku barcode title price compareAtPrice product{ title productType tags status }
        inventoryItem{ s:inventoryLevel(locationId:$s){ quantities(names:["available"]){quantity} } w:inventoryLevel(locationId:$w){ quantities(names:["available"]){quantity} } } } } }`,
      { ids: ids.slice(i, i + 100), s: store.locId, w: ONLINE_WAREHOUSE_ID }
    );
    for (const v of d.nodes) {
      if (!v || !v.product) continue;
      out[v.id] = { sku: v.sku || "", barcode: v.barcode || "", title: v.title, price: v.price, compareAtPrice: v.compareAtPrice, product: v.product, store: qty(v.inventoryItem.s), wh: qty(v.inventoryItem.w) };
    }
  }
  return out;
}

export type Built = { lines: Omit<PickLine, "id" | "run_id" | "picked" | "picked_by" | "picked_at" | "method">[]; removed: Removed[] };

/** Apply the Store Replen rules for one store over a window. */
export async function computePickList(storeKey: StoreKey, start: Date, end: Date): Promise<Built> {
  const store = STORES.find((s) => s.key === storeKey)!;
  const { sold, orderIds } = await posSales(store, start, end);
  await storeFulfilled(store, start, end, orderIds, sold);
  const ids = Object.keys(sold);
  const vars = await variantDetails(ids, store);
  const skus = Object.values(vars).map((v) => v.sku).filter(Boolean);
  const binRows = skus.length ? await q<{ sku: string; bin: string }>("SELECT sku, bin FROM bins WHERE sku = ANY($1)", [skus]) : [];
  const bins: Record<string, string> = {}; for (const b of binRows) bins[b.sku] = b.bin;

  const lines: Built["lines"] = []; const removed: Removed[] = [];
  for (const vid of ids) {
    const v = vars[vid]; if (!v) continue;
    const [size, colour] = splitTitle(v.title);
    const tags = v.product.tags.map((t) => t.toLowerCase());
    const base = { product: v.product.title.replace(/ - FINAL SALE$/i, ""), size, colour, sku: v.sku, sold: sold[vid] };
    const price = Number(v.price), cap = Number(v.compareAtPrice);
    const reason =
      tags.includes("nostorereplenish") ? "nostorereplenish tag" :
      tags.includes(store.nosend) ? store.nosend + " tag" :
      tags.includes("final-sale") ? "FINAL SALE" :
      cap > price && 1 - price / cap >= MAX_DISCOUNT - 1e-9 ? Math.round((1 - price / cap) * 100) + "% off" :
      v.wh < MIN_WAREHOUSE ? `Warehouse ${v.wh} (<${MIN_WAREHOUSE})` : null;
    if (reason) { removed.push({ ...base, reason }); continue; }
    const dept = /^mens/i.test(v.product.productType) ? "Mens" : "Womens";
    const target = dept === "Mens" && !/jacket/i.test(v.product.productType + " " + v.product.title) ? 2 : 1;
    const pick = Math.max(0, Math.min(target - v.store, v.wh));
    if (pick === 0) { removed.push({ ...base, reason: `Store already has ${v.store} (target ${target})` }); continue; }
    lines.push({ variant_id: vid, sku: v.sku, barcode: v.barcode, product: base.product, size, colour, dept, bin: bins[v.sku] || "", sold: sold[vid], store_stock: v.store, wh_stock: v.wh, pick });
  }
  lines.sort(sortLines);
  return { lines, removed };
}

export function sortLines<T extends { bin: string; product: string; size: string }>(a: T, b: T) {
  return (a.bin ? 0 : 1) - (b.bin ? 0 : 1) || binSort(a.bin, b.bin) || a.product.localeCompare(b.product) || sizeIdx(a.size) - sizeIdx(b.size);
}

export async function openRunFor(storeKey: StoreKey, start: Date, end: Date): Promise<PickRun | null> {
  await ensure();
  const r = await q<PickRun>(`SELECT * FROM pick_runs WHERE store_key=$1 AND "start"=$2 AND "end"=$3 AND status='open' ORDER BY id DESC LIMIT 1`, [storeKey, start.toISOString(), end.toISOString()]);
  return r[0] || null;
}

/** Build and save a run. An existing open run for the same store/window is returned instead unless force (then it is marked superseded, never deleted). */
export async function createRun(storeKey: StoreKey, from: string | null, to: string | null, by: string, force = false): Promise<{ run: PickRun; existing: boolean }> {
  await ensure();
  const store = STORES.find((s) => s.key === storeKey); if (!store) throw new Error("Unknown store");
  const w = rangeFor(from, to);
  const open = await openRunFor(storeKey, w.start, w.end);
  if (open && !force) return { run: open, existing: true };
  const built = await computePickList(storeKey, w.start, w.end);
  if (open) await q("UPDATE pick_runs SET status='superseded' WHERE id=$1", [open.id]);
  const [run] = await q<PickRun>(
    `INSERT INTO pick_runs(store_key, store, "start", "end", label, created_by, lines, units, removed, removed_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [storeKey, store.name, w.start.toISOString(), w.end.toISOString(), w.label, by, built.lines.length, built.lines.reduce((a, l) => a + l.pick, 0), built.removed.length, JSON.stringify(built.removed)]
  );
  for (const l of built.lines) {
    await q("INSERT INTO pick_lines(run_id,variant_id,sku,barcode,product,size,colour,dept,bin,sold,store_stock,wh_stock,pick) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
      [run.id, l.variant_id, l.sku, l.barcode, l.product, l.size, l.colour, l.dept, l.bin, l.sold, l.store_stock, l.wh_stock, l.pick]);
  }
  return { run, existing: false };
}

/** Rebuild from Shopify with the same store/window. The old run is marked superseded (kept, never deleted). */
export async function rebuildRun(runId: number, by: string): Promise<PickRun> {
  await ensure();
  const old = (await q<PickRun>("SELECT * FROM pick_runs WHERE id=$1", [runId]))[0]; if (!old) throw new Error("Not found");
  if (old.status === "finished") throw new Error("Finished lists can't be rebuilt – start a new one");
  const start = new Date(old.start), end = new Date(old.end);
  const built = await computePickList(old.store_key as StoreKey, start, end);
  await q("UPDATE pick_runs SET status='superseded' WHERE id=$1", [runId]);
  const [run] = await q<PickRun>(
    `INSERT INTO pick_runs(store_key, store, "start", "end", label, created_by, lines, units, removed, removed_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [old.store_key, old.store, start.toISOString(), end.toISOString(), old.label, by, built.lines.length, built.lines.reduce((a, l) => a + l.pick, 0), built.removed.length, JSON.stringify(built.removed)]
  );
  for (const l of built.lines) {
    await q("INSERT INTO pick_lines(run_id,variant_id,sku,barcode,product,size,colour,dept,bin,sold,store_stock,wh_stock,pick) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
      [run.id, l.variant_id, l.sku, l.barcode, l.product, l.size, l.colour, l.dept, l.bin, l.sold, l.store_stock, l.wh_stock, l.pick]);
  }
  return run;
}

export async function getRun(id: number): Promise<{ run: PickRun; lines: PickLine[]; removed: Removed[] } | null> {
  await ensure();
  const r = await q<PickRun & { removed_json: string }>("SELECT * FROM pick_runs WHERE id=$1", [id]); if (!r[0]) return null;
  const lines = await q<PickLine>("SELECT * FROM pick_lines WHERE run_id=$1", [id]);
  lines.sort(sortLines);
  const { removed_json, ...run } = r[0];
  let removed: Removed[] = []; try { removed = JSON.parse(removed_json || "[]"); } catch {}
  return { run, lines, removed };
}

export async function listRuns(limit = 30): Promise<(PickRun & { picked: number })[]> {
  await ensure();
  return q(`SELECT r.id, r.store_key, r.store, r."start", r."end", r.label, r.created_at, r.created_by, r.status, r.finished_at, r.finished_by, r.lines, r.units, r.removed,
    COALESCE((SELECT sum(picked) FROM pick_lines l WHERE l.run_id=r.id),0)::int AS picked FROM pick_runs r WHERE r.status<>'superseded' ORDER BY r.id DESC LIMIT $1`, [limit]);
}

export type ScanResult = { ok: true; line: PickLine; complete: boolean } | { ok: false; reason: "not_on_list" | "already_picked" | "finished" | "wrong_dept"; line?: PickLine; message: string };

/** One scan = one unit picked on the matching line. dept narrows to the section being picked (Womens/Mens) so a scan from the other list is refused. */
export async function scanLine(runId: number, barcode: string, by: string, dept?: string | null): Promise<ScanResult> {
  await ensure();
  const code = barcode.trim();
  const run = await q<PickRun>("SELECT * FROM pick_runs WHERE id=$1", [runId]);
  if (!run[0]) return { ok: false, reason: "not_on_list", message: "Pick list not found" };
  if (run[0].status === "finished") return { ok: false, reason: "finished", message: "This pick list is finished" };
  // match by barcode, else by SKU (gun might read the SKU label)
  const cands = await q<PickLine>("SELECT * FROM pick_lines WHERE run_id=$1 AND (barcode=$2 OR (sku<>'' AND sku=$2)) ORDER BY (picked < pick) DESC, id", [runId, code]);
  if (!cands.length) return { ok: false, reason: "not_on_list", message: "Not on this pick list" };
  const inDept = dept ? cands.filter((c) => c.dept === dept) : cands;
  if (dept && !inDept.length) return { ok: false, reason: "wrong_dept", line: cands[0], message: `That's on the ${cands[0].dept} list` };
  const open = inDept.find((c) => c.picked < c.pick);
  if (!open) return { ok: false, reason: "already_picked", line: inDept[0], message: `Already picked ${inDept[0].picked} of ${inDept[0].pick}` };
  const [line] = await q<PickLine>("UPDATE pick_lines SET picked=picked+1, picked_by=$2, picked_at=now(), method=CASE WHEN method='skipped' OR method IS NULL THEN 'scan' ELSE method END WHERE id=$1 RETURNING *", [open.id, by]);
  return { ok: true, line, complete: line.picked >= line.pick };
}

/** Manual override: mark a line fully picked without scanning (flagged), or undo it. */
export async function overrideLine(runId: number, lineId: number, action: "pick" | "undo" | "skip", by: string): Promise<PickLine | null> {
  await ensure();
  const r = action === "pick"
    ? await q<PickLine>("UPDATE pick_lines SET picked=pick, picked_by=$3, picked_at=now(), method='manual' WHERE id=$1 AND run_id=$2 RETURNING *", [lineId, runId, by])
    : action === "skip"
    ? await q<PickLine>("UPDATE pick_lines SET picked_by=$3, picked_at=now(), method='skipped' WHERE id=$1 AND run_id=$2 RETURNING *", [lineId, runId, by])
    : await q<PickLine>("UPDATE pick_lines SET picked=0, picked_by=NULL, picked_at=NULL, method=NULL WHERE id=$1 AND run_id=$2 RETURNING *", [lineId, runId]);
  return r[0] || null;
}

/** Finish: lock the run and write what was actually picked to the permanent Sent log (one row per line, dated today in Melbourne). */
export async function finishRun(runId: number, by: string): Promise<{ ok: boolean; sent: number; units: number; message?: string }> {
  await ensure();
  const got = await getRun(runId); if (!got) return { ok: false, sent: 0, units: 0, message: "Not found" };
  if (got.run.status === "finished") return { ok: false, sent: 0, units: 0, message: "Already finished" };
  const picked = got.lines.filter((l) => l.picked > 0);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  for (const l of picked) await q("INSERT INTO sent_log(store, sent_date, sku, product, size, colour, qty, run_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [got.run.store, today, l.sku, l.product, l.size, l.colour, l.picked, runId]);
  await q("UPDATE pick_runs SET status='finished', finished_at=now(), finished_by=$2 WHERE id=$1", [runId, by]);
  return { ok: true, sent: picked.length, units: picked.reduce((a, l) => a + l.picked, 0) };
}

/** Senitron transfer manifest: one row per picked line. */
export function manifestCsv(lines: PickLine[]) {
  const esc = (s: string) => /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  const rows = [["Item", "SKU", "Barcode", "Qty"].join(",")];
  for (const l of lines) if (l.picked > 0) rows.push([esc([l.product, l.size, l.colour].filter(Boolean).join(" - ")), esc(l.sku), esc(l.barcode), String(l.picked)].join(","));
  return rows.join("\r\n") + "\r\n";
}
