// UNISEX balancing: "Unisex X" and "X" are the same garment under two listings (own SKU + own barcode each).
// Keep Unisex lightly stocked (target per size) from Mens, never taking Mens below its floor; send back to Mens only when Mens is at 0.
// Online Warehouse (Preston) only. The only Shopify write is a PAIRED adjustment: -n on one variant, +n on its twin, same size, so total stock never changes.
import { q } from "./db";
import { gql, ONLINE_WAREHOUSE_ID, shopifyConfigured } from "./shopify";
import { binSort, sizeIdx } from "./putaway";
import type { PickLine } from "./picklist";

export const UNISEX_TARGET = 2;   // keep this many of each size on the Unisex listing
export const MENS_FLOOR = 3;      // never take Mens below this; under this, leave it alone
export const MAX_BACK = 5;        // Unisex → Mens: never move more than this per size (relabelling back and forth is a chore)

export type UnisexLine = PickLine & { adjusted: number; to_variant_id: string; to_inventory_item_id: string; to_sku: string; to_barcode: string; to_bin: string; to_product: string; from_inventory_item_id: string; direction: string; from_stock: number; to_stock: number };
export type UnisexRun = { id: number; created_at: string; created_by: string; status: string; lines: number; units: number; pairs: number; adjustments: number; adjusted_at: string | null; adjusted_by: string | null; shopify_ref: string | null; error: string | null; label: string; store: string; removed: number };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS unisex_runs (
  id serial PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'open',
  lines integer NOT NULL DEFAULT 0, units integer NOT NULL DEFAULT 0, pairs integer NOT NULL DEFAULT 0, adjusted_at timestamptz, adjusted_by text, shopify_ref text, error text, notes_json text NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS unisex_lines (
  id serial PRIMARY KEY, run_id integer NOT NULL REFERENCES unisex_runs(id) ON DELETE CASCADE,
  variant_id text NOT NULL, from_inventory_item_id text NOT NULL, sku text NOT NULL DEFAULT '', barcode text NOT NULL DEFAULT '', bin text NOT NULL DEFAULT '',
  to_variant_id text NOT NULL, to_inventory_item_id text NOT NULL, to_sku text NOT NULL DEFAULT '', to_barcode text NOT NULL DEFAULT '', to_bin text NOT NULL DEFAULT '', to_product text NOT NULL DEFAULT '',
  product text NOT NULL, size text NOT NULL DEFAULT '', colour text NOT NULL DEFAULT '', dept text NOT NULL DEFAULT '', direction text NOT NULL,
  from_stock integer NOT NULL, to_stock integer NOT NULL, sold integer NOT NULL DEFAULT 0, store_stock integer NOT NULL DEFAULT 0, wh_stock integer NOT NULL DEFAULT 0,
  pick integer NOT NULL, picked integer NOT NULL DEFAULT 0, picked_by text, picked_at timestamptz, method text
);
CREATE INDEX IF NOT EXISTS unisex_lines_run ON unisex_lines(run_id);
ALTER TABLE unisex_lines ADD COLUMN IF NOT EXISTS adjusted integer NOT NULL DEFAULT 0;
ALTER TABLE unisex_runs ADD COLUMN IF NOT EXISTS adjustments integer NOT NULL DEFAULT 0;
`;
let ready: Promise<void> | null = null;
async function ensure() { if (!ready) ready = (async () => { for (const s of SCHEMA.split(";").map((x) => x.trim()).filter(Boolean)) await q(s); })(); await ready; }

type V = { id: string; sku: string | null; barcode: string | null; title: string; inventoryItem: { id: string; lvl: { quantities: { quantity: number }[] } | null } };
type Prod = { id: string; title: string; status: string; tags: string[]; variants: { nodes: V[] } };
const PROD_FIELDS = `id title status tags variants(first:40){ nodes{ id sku barcode title inventoryItem{ id lvl: inventoryLevel(locationId:$loc){ quantities(names:["available"]){ quantity } } } } }`;
const avail = (v: V) => v.inventoryItem.lvl?.quantities?.[0]?.quantity ?? 0;
const sizeOf = (t: string) => (t === "Default Title" ? "One size" : t.split(" / ")[0]);
const isFS = (p: Prod) => / - FINAL SALE$/i.test(p.title) || p.tags.some((t) => t.toLowerCase() === "final-sale");

/** All active "Unisex …" products with their twins, Preston availability per variant. */
async function loadPairs(): Promise<{ unisex: Prod; mens: Prod }[]> {
  const unisex: Prod[] = []; let after: string | null = null;
  for (let i = 0; i < 20; i++) {
    const d: { products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Prod[] } } = await gql(
      `query($after:String,$loc:ID!){ products(first:50, after:$after, query:"title:Unisex* status:active"){ pageInfo{ hasNextPage endCursor } nodes{ ${PROD_FIELDS} } } }`, { after, loc: ONLINE_WAREHOUSE_ID });
    unisex.push(...d.products.nodes.filter((p) => /^Unisex /i.test(p.title)));
    if (!d.products.pageInfo.hasNextPage) break; after = d.products.pageInfo.endCursor;
  }
  const out: { unisex: Prod; mens: Prod }[] = [];
  for (let i = 0; i < unisex.length; i += 10) {
    const chunk = unisex.slice(i, i + 10);
    const query = chunk.map((p) => `title:'${p.title.replace(/^Unisex /i, "").replace(/'/g, "")}'`).join(" OR ");
    const d: { products: { nodes: Prod[] } } = await gql(`query($q:String!,$loc:ID!){ products(first:50, query:$q){ nodes{ ${PROD_FIELDS} } } }`, { q: query + " status:active", loc: ONLINE_WAREHOUSE_ID });
    for (const u of chunk) {
      const want = u.title.replace(/^Unisex /i, "").toLowerCase();
      const m = d.products.nodes.find((p) => p.title.toLowerCase() === want || p.title.toLowerCase() === want + " - final sale");
      if (m) out.push({ unisex: u, mens: m });
    }
  }
  return out;
}

export type Note = { product: string; size: string; reason: string };

/** Apply the rules and save a run. */
export async function createUnisexRun(by: string): Promise<UnisexRun> {
  await ensure();
  if (!shopifyConfigured()) throw new Error("Shopify isn't connected on this server");
  const pairs = await loadPairs();
  const skus = pairs.flatMap((p) => [...p.unisex.variants.nodes, ...p.mens.variants.nodes].map((v) => v.sku || "")).filter(Boolean);
  const binRows = skus.length ? await q<{ sku: string; bin: string }>("SELECT sku, bin FROM bins WHERE sku = ANY($1)", [skus]) : [];
  const bins: Record<string, string> = {}; for (const b of binRows) bins[b.sku] = b.bin;
  const lines: Omit<UnisexLine, "id" | "run_id" | "picked" | "picked_by" | "picked_at" | "method" | "adjusted">[] = []; const notes: Note[] = [];
  for (const { unisex, mens } of pairs) {
    if (isFS(unisex) || isFS(mens)) { notes.push({ product: mens.title, size: "", reason: "FINAL SALE – left alone" }); continue; }
    const uBy: Record<string, V> = {}; for (const v of unisex.variants.nodes) uBy[sizeOf(v.title)] = v;
    for (const mv of mens.variants.nodes) {
      const size = sizeOf(mv.title); const uv = uBy[size];
      if (!uv) { notes.push({ product: mens.title, size, reason: "no Unisex size to match" }); continue; }
      const m = avail(mv), u = avail(uv);
      const base = { product: mens.title.replace(/ - FINAL SALE$/i, ""), size, colour: "", dept: "", sold: 0, store_stock: 0, wh_stock: 0 };
      if (u < UNISEX_TARGET && m > MENS_FLOOR) {
        const n = Math.min(UNISEX_TARGET - u, m - MENS_FLOOR);
        if (n > 0) lines.push({ ...base, dept: "Mens → Unisex", direction: "M>U", variant_id: mv.id, from_inventory_item_id: mv.inventoryItem.id, sku: mv.sku || "", barcode: mv.barcode || "", bin: bins[mv.sku || ""] || "", to_variant_id: uv.id, to_inventory_item_id: uv.inventoryItem.id, to_sku: uv.sku || "", to_barcode: uv.barcode || "", to_bin: bins[uv.sku || ""] || "", to_product: unisex.title, from_stock: m, to_stock: u, pick: n });
      } else if (m === 0 && u > UNISEX_TARGET) {
        const n = Math.min(MAX_BACK, u - UNISEX_TARGET);
        lines.push({ ...base, product: unisex.title, dept: "Unisex → Mens", direction: "U>M", variant_id: uv.id, from_inventory_item_id: uv.inventoryItem.id, sku: uv.sku || "", barcode: uv.barcode || "", bin: bins[uv.sku || ""] || "", to_variant_id: mv.id, to_inventory_item_id: mv.inventoryItem.id, to_sku: mv.sku || "", to_barcode: mv.barcode || "", to_bin: bins[mv.sku || ""] || "", to_product: mens.title.replace(/ - FINAL SALE$/i, ""), from_stock: u, to_stock: m, pick: n });
      } else if (u < UNISEX_TARGET && m <= MENS_FLOOR && m > 0) notes.push({ product: mens.title, size, reason: `Unisex ${u}, Mens only ${m} – under the floor of ${MENS_FLOOR}, left` });
    }
  }
  lines.sort((a, b) => (a.bin ? 0 : 1) - (b.bin ? 0 : 1) || binSort(a.bin, b.bin) || a.product.localeCompare(b.product) || sizeIdx(a.size) - sizeIdx(b.size));
  const [run] = await q<UnisexRun>("INSERT INTO unisex_runs(created_by, lines, units, pairs, notes_json) VALUES($1,$2,$3,$4,$5) RETURNING *", [by, lines.length, lines.reduce((a, l) => a + l.pick, 0), pairs.length, JSON.stringify(notes)]);
  for (const l of lines) await q(
    "INSERT INTO unisex_lines(run_id,variant_id,from_inventory_item_id,sku,barcode,bin,to_variant_id,to_inventory_item_id,to_sku,to_barcode,to_bin,to_product,product,size,dept,direction,from_stock,to_stock,pick) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)",
    [run.id, l.variant_id, l.from_inventory_item_id, l.sku, l.barcode, l.bin, l.to_variant_id, l.to_inventory_item_id, l.to_sku, l.to_barcode, l.to_bin, l.to_product, l.product, l.size, l.dept, l.direction, l.from_stock, l.to_stock, l.pick]);
  return decorate(run);
}

function decorate(r: UnisexRun & { notes_json?: string }): UnisexRun {
  const { notes_json, ...rest } = r; void notes_json;
  return { ...rest, store: "Unisex", label: `${r.pairs} pairs checked · ${r.lines} moves · ${r.units} units${r.adjusted_at ? ` · last adjusted ${fmtTs(r.adjusted_at)} by ${r.adjusted_by}${r.adjustments > 1 ? ` (${r.adjustments}×)` : ""}` : ""}`, removed: 0 };
}
const fmtTs = (ts: string | null) => ts ? new Date(ts).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

export async function getUnisexRun(id: number) {
  await ensure();
  const r = await q<UnisexRun & { notes_json: string }>("SELECT * FROM unisex_runs WHERE id=$1", [id]); if (!r[0]) return null;
  const raw = await q<UnisexLine>("SELECT * FROM unisex_lines WHERE run_id=$1", [id]);
  raw.sort((a, b) => (a.bin ? 0 : 1) - (b.bin ? 0 : 1) || binSort(a.bin, b.bin) || a.product.localeCompare(b.product) || sizeIdx(a.size) - sizeIdx(b.size));
  const lines = raw.map((l) => ({ ...l, note: `→ ${l.to_bin || "no bin"} · relabel ${l.to_barcode || "?"}${l.adjusted ? ` · ${l.adjusted} adjusted in Shopify` : ""}` }));
  let notes: Note[] = []; try { notes = JSON.parse(r[0].notes_json || "[]"); } catch {}
  const run = { ...decorate(r[0]), status: r[0].status === "adjusted" ? "finished" : r[0].status };
  return { run, lines, removed: notes.map((n) => ({ product: n.product, size: n.size, colour: "", sku: "", sold: 0, reason: n.reason })) };
}

export async function listUnisexRuns(limit = 20) {
  await ensure();
  const rs = await q<UnisexRun & { notes_json: string; picked: number }>(`SELECT r.*, COALESCE((SELECT sum(picked) FROM unisex_lines l WHERE l.run_id=r.id),0)::int AS picked FROM unisex_runs r ORDER BY r.id DESC LIMIT $1`, [limit]);
  return rs.map((r) => ({ ...decorate(r), picked: r.picked }));
}

export async function scanUnisex(runId: number, barcode: string, by: string, dept?: string | null) {
  await ensure();
  const code = barcode.trim();
  const run = (await q<UnisexRun>("SELECT * FROM unisex_runs WHERE id=$1", [runId]))[0];
  if (!run) return { ok: false as const, reason: "not_on_list", message: "Run not found" };
  if (run.status === "adjusted") return { ok: false as const, reason: "finished", message: "This run was closed – start a new RUN" };
  const cands = await q<UnisexLine>("SELECT * FROM unisex_lines WHERE run_id=$1 AND (barcode=$2 OR (sku<>'' AND sku=$2)) ORDER BY (picked < pick) DESC, id", [runId, code]);
  if (!cands.length) {
    const wrong = await q<UnisexLine>("SELECT * FROM unisex_lines WHERE run_id=$1 AND (to_barcode=$2 OR to_sku=$2) LIMIT 1", [runId, code]);
    if (wrong[0]) return { ok: false as const, reason: "not_on_list", line: wrong[0], message: `That's the NEW label – scan the garment's current (${wrong[0].direction === "M>U" ? "Mens" : "Unisex"}) barcode` };
    return { ok: false as const, reason: "not_on_list", message: "Not on this list" };
  }
  const inDept = dept ? cands.filter((c) => c.dept === dept) : cands;
  if (dept && !inDept.length) return { ok: false as const, reason: "wrong_dept", line: cands[0], message: `That's on the ${cands[0].dept} list` };
  const open = inDept.find((c) => c.picked < c.pick);
  if (!open) return { ok: false as const, reason: "already_picked", line: inDept[0], message: `Already picked ${inDept[0].picked} of ${inDept[0].pick}` };
  const [line] = await q<UnisexLine>("UPDATE unisex_lines SET picked=picked+1, picked_by=$2, picked_at=now(), method=CASE WHEN method='skipped' OR method IS NULL THEN 'scan' ELSE method END WHERE id=$1 RETURNING *", [open.id, by]);
  return { ok: true as const, line, complete: line.picked >= line.pick };
}

export async function overrideUnisex(runId: number, lineId: number, action: "pick" | "undo" | "skip", by: string) {
  await ensure();
  const r = action === "pick"
    ? await q<UnisexLine>("UPDATE unisex_lines SET picked=pick, picked_by=$3, picked_at=now(), method='manual' WHERE id=$1 AND run_id=$2 RETURNING *", [lineId, runId, by])
    : action === "skip"
    ? await q<UnisexLine>("UPDATE unisex_lines SET picked_by=$3, picked_at=now(), method='skipped' WHERE id=$1 AND run_id=$2 RETURNING *", [lineId, runId, by])
    : await q<UnisexLine>("UPDATE unisex_lines SET picked=adjusted, picked_by=CASE WHEN adjusted>0 THEN picked_by ELSE NULL END, picked_at=CASE WHEN adjusted>0 THEN picked_at ELSE NULL END, method=CASE WHEN adjusted>0 THEN method ELSE NULL END WHERE id=$1 AND run_id=$2 RETURNING *", [lineId, runId]);
  return r[0] || null;
}

/** ADJUST COUNTS: one atomic Shopify call – for every picked line, −picked on the source variant and +picked on its twin, Preston only. */
export async function adjustUnisexRun(id: number, by: string): Promise<{ ok: boolean; sent: number; units: number; message?: string }> {
  await ensure();
  const got = await getUnisexRun(id); if (!got) return { ok: false, sent: 0, units: 0, message: "Not found" };
  const raw = await q<UnisexRun>("SELECT * FROM unisex_runs WHERE id=$1", [id]);
  if (raw[0].status === "adjusting") return { ok: false, sent: 0, units: 0, message: "An adjustment is already running – wait a moment and refresh" };
  // only what has been picked since the last adjustment
  const picked = got.lines.map((l) => ({ ...l, picked: Math.min(l.picked, l.pick) - (l.adjusted || 0), full: l })).filter((l) => l.picked > 0 && l.method !== "skipped");
  if (!picked.length) return { ok: false, sent: 0, units: 0, message: "Nothing new picked since the last adjustment" };
  // safety: every pair is equal and opposite, so the sum of all deltas is zero by construction
  const changes = picked.flatMap((l) => [
    { inventoryItemId: l.from_inventory_item_id, locationId: ONLINE_WAREHOUSE_ID, delta: -l.picked },
    { inventoryItemId: l.to_inventory_item_id, locationId: ONLINE_WAREHOUSE_ID, delta: l.picked },
  ]);
  if (changes.reduce((a, c) => a + c.delta, 0) !== 0) return { ok: false, sent: 0, units: 0, message: "Internal check failed (deltas don't net to zero) – nothing sent" };
  await q("UPDATE unisex_runs SET status='adjusting' WHERE id=$1", [id]);
  try {
    type R = { inventoryAdjustQuantities: { userErrors: { field: string[] | null; message: string }[]; inventoryAdjustmentGroup: { id: string } | null } };
    const d = await gql<R>(
      `mutation($input: InventoryAdjustQuantitiesInput!){ inventoryAdjustQuantities(input:$input){ userErrors{ field message } inventoryAdjustmentGroup{ id } } }`,
      { input: { name: "available", reason: "correction", referenceDocumentUri: `${process.env.NEXT_PUBLIC_SITE_URL || "https://bs-warehouse.vercel.app"}/unisex/${id}?type=UNISEX-TRANSFER&by=${encodeURIComponent(by)}`, changes } }
    );
    if (d.inventoryAdjustQuantities.userErrors?.length) throw new Error(d.inventoryAdjustQuantities.userErrors.map((e) => e.message).join("; "));
    const ref = d.inventoryAdjustQuantities.inventoryAdjustmentGroup?.id || "";
    for (const l of picked) await q("UPDATE unisex_lines SET adjusted=adjusted+$2 WHERE id=$1", [l.id, l.picked]);
    await q("UPDATE unisex_runs SET status='open', adjusted_at=now(), adjusted_by=$2, shopify_ref=$3, error=NULL, adjustments=adjustments+1 WHERE id=$1", [id, by, ref]);
    return { ok: true, sent: picked.length, units: picked.reduce((a, l) => a + l.picked, 0) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await q("UPDATE unisex_runs SET status='open', error=$2 WHERE id=$1", [id, msg]);
    return { ok: false, sent: 0, units: 0, message: "Shopify refused the adjustment – nothing was changed: " + msg };
  }
}

/** Label CSV for the barcode printer: Title, ALU (new barcode), Quantity. One row per picked line. */
export function labelsCsv(lines: UnisexLine[]) {
  const esc = (s: string) => /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  const rows = ["Title,ALU,Quantity"];
  for (const l of lines) if (l.picked > 0 && l.method !== "skipped") rows.push([esc(`${l.to_product} - ${l.size}`), esc(l.to_barcode), String(l.picked)].join(","));
  return rows.join("\r\n") + "\r\n";
}
