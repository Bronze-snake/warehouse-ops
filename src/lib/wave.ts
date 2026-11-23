// Order waves: N orders awaiting shipment in ShipStation, merged into one pick list by SKU in bin order.
// Lines are tagged "Singles" (from one-unit orders) or "Multis" so the two can be picked separately.
// Picking state is shared (database). ShipStation is only ever touched to ADD a tag "WAVE-<id>" – and only when the wave is not a preview.
import { q } from "./db";
import { listPending, tagShipments, shipstationConfigured, type SSShipment } from "./shipstation";
import { resolveSkus } from "./shopify";
import { sortLines, type PickLine } from "./picklist";

export type WaveRun = { id: number; created_at: string; created_by: string; status: string; finished_at: string | null; finished_by: string | null; orders: number; units: number; lines: number; mode: string; preview: boolean; tag: string | null; tag_error: string | null };
export type WaveOrder = { number: string; name: string; items: number; shipment_id: string };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS wave_runs (
  id serial PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'open',
  finished_at timestamptz, finished_by text, orders integer NOT NULL DEFAULT 0, units integer NOT NULL DEFAULT 0, lines integer NOT NULL DEFAULT 0,
  mode text NOT NULL DEFAULT 'all', preview boolean NOT NULL DEFAULT true, tag text, tag_error text
);
CREATE TABLE IF NOT EXISTS wave_orders (
  id serial PRIMARY KEY, wave_id integer NOT NULL REFERENCES wave_runs(id) ON DELETE CASCADE, shipment_id text NOT NULL, number text NOT NULL, name text NOT NULL DEFAULT '',
  items integer NOT NULL, single boolean NOT NULL, items_json text NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS wave_orders_wave ON wave_orders(wave_id);
CREATE TABLE IF NOT EXISTS wave_lines (
  id serial PRIMARY KEY, run_id integer NOT NULL REFERENCES wave_runs(id) ON DELETE CASCADE,
  variant_id text NOT NULL DEFAULT '', sku text NOT NULL DEFAULT '', barcode text NOT NULL DEFAULT '', product text NOT NULL, size text NOT NULL DEFAULT '', colour text NOT NULL DEFAULT '',
  dept text NOT NULL DEFAULT '', bin text NOT NULL DEFAULT '', sold integer NOT NULL DEFAULT 0, store_stock integer NOT NULL DEFAULT 0, wh_stock integer NOT NULL DEFAULT 0, pick integer NOT NULL,
  picked integer NOT NULL DEFAULT 0, picked_by text, picked_at timestamptz, method text
);
CREATE INDEX IF NOT EXISTS wave_lines_run ON wave_lines(run_id);
`;
let ready: Promise<void> | null = null;
async function ensure() { if (!ready) ready = (async () => { for (const s of SCHEMA.split(";").map((x) => x.trim()).filter(Boolean)) await q(s); })(); await ready; }

export type Mode = "all" | "singles" | "multis";

/** What a wave would contain right now (no writes anywhere). */
export async function previewWave(size: number, mode: Mode): Promise<{ orders: SSShipment[]; queue: number; singlesInQueue: number }> {
  if (!shipstationConfigured()) throw new Error("ShipStation isn't connected on this server (SHIPSTATION_API_KEY)");
  const pending = await listPending(Math.max(600, size * 3));
  const pick = pending.filter((s) => s.items.length > 0 && (mode === "all" || (mode === "singles" ? s.units === 1 : s.units > 1)));
  return { orders: pick.slice(0, size), queue: pending.length, singlesInQueue: pending.filter((s) => s.units === 1).length };
}

/** Build a wave. preview=true: nothing is written to ShipStation. preview=false: the orders are tagged WAVE-<id>. */
export async function createWave(size: number, mode: Mode, by: string, preview: boolean): Promise<WaveRun> {
  await ensure();
  const { orders } = await previewWave(size, mode);
  if (!orders.length) throw new Error("No orders awaiting shipment match that filter");
  // merge by SKU within Singles / Multis
  type Agg = { sku: string; name: string; qty: number; dept: string; orders: Set<string> };
  const agg: Record<string, Agg> = {};
  for (const o of orders) {
    const dept = o.units === 1 ? "Singles" : "Multis";
    for (const it of o.items) {
      const key = dept + "|" + (it.sku || "name:" + it.name);
      if (!agg[key]) agg[key] = { sku: it.sku, name: it.name, qty: 0, dept, orders: new Set() };
      agg[key].qty += it.quantity; agg[key].orders.add(o.shipment_number);
    }
  }
  const info = await resolveSkus(Object.values(agg).map((a) => a.sku));
  const skus = Object.keys(info);
  const binRows = skus.length ? await q<{ sku: string; bin: string }>("SELECT sku, bin FROM bins WHERE sku = ANY($1)", [skus]) : [];
  const bins: Record<string, string> = {}; for (const b of binRows) bins[b.sku] = b.bin;
  const lines = Object.values(agg).map((a) => {
    const v = info[a.sku];
    // ShipStation item name is usually "Product - Size / Colour"; fall back to it when Shopify has no match
    const [fbProduct, fbRest] = a.name.includes(" - ") ? [a.name.slice(0, a.name.lastIndexOf(" - ")), a.name.slice(a.name.lastIndexOf(" - ") + 3)] : [a.name, ""];
    const [fbSize, fbColour] = fbRest.split(" / ");
    return { variant_id: v?.variant_id || "", sku: a.sku, barcode: v?.barcode || "", product: v?.product || fbProduct, size: v?.size || fbSize || "", colour: v?.colour || fbColour || "", dept: a.dept, bin: bins[a.sku] || "", sold: a.orders.size, store_stock: 0, wh_stock: 0, pick: a.qty };
  }).sort(sortLines);
  const units = lines.reduce((s, l) => s + l.pick, 0);
  const [run] = await q<WaveRun>("INSERT INTO wave_runs(created_by, orders, units, lines, mode, preview, status) VALUES($1,$2,$3,$4,$5,$6,'open') RETURNING *", [by, orders.length, units, lines.length, mode, preview]);
  for (const o of orders) await q("INSERT INTO wave_orders(wave_id, shipment_id, number, name, items, single, items_json) VALUES($1,$2,$3,$4,$5,$6,$7)", [run.id, o.shipment_id, o.shipment_number, o.ship_to_name, o.units, o.units === 1, JSON.stringify(o.items)]);
  for (const l of lines) await q("INSERT INTO wave_lines(run_id,variant_id,sku,barcode,product,size,colour,dept,bin,sold,pick) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [run.id, l.variant_id, l.sku, l.barcode, l.product, l.size, l.colour, l.dept, l.bin, l.sold, l.pick]);
  if (!preview) {
    const tag = `WAVE-${run.id}`;
    try {
      const r = await tagShipments(orders.map((o) => o.shipment_id), tag);
      await q("UPDATE wave_runs SET tag=$2, tag_error=$3 WHERE id=$1", [run.id, tag, r.failed.length ? `${r.failed.length} order(s) could not be tagged` : null]);
    } catch (e) { await q("UPDATE wave_runs SET tag_error=$2 WHERE id=$1", [run.id, e instanceof Error ? e.message : String(e)]); }
  }
  return (await q<WaveRun>("SELECT * FROM wave_runs WHERE id=$1", [run.id]))[0];
}

export async function getWave(id: number) {
  await ensure();
  const r = await q<WaveRun>("SELECT * FROM wave_runs WHERE id=$1", [id]); if (!r[0]) return null;
  const lines = await q<PickLine>("SELECT * FROM wave_lines WHERE run_id=$1", [id]); lines.sort(sortLines);
  const orders = await q<WaveOrder>("SELECT number, name, items, shipment_id FROM wave_orders WHERE wave_id=$1 ORDER BY id", [id]);
  const w = r[0];
  // same shape PickView expects
  const run = { ...w, store: "Wave", label: `${w.orders} orders · ${w.mode === "all" ? "singles + multis" : w.mode}${w.preview ? " · PREVIEW (ShipStation untouched)" : w.tag ? ` · tagged ${w.tag}` : ""}`, removed: 0, orders };
  return { run, lines, removed: [] as never[] };
}

export async function listWaves(limit = 30) {
  await ensure();
  return q<WaveRun & { picked: number }>(`SELECT r.*, COALESCE((SELECT sum(picked) FROM wave_lines l WHERE l.run_id=r.id),0)::int AS picked FROM wave_runs r ORDER BY r.id DESC LIMIT $1`, [limit]);
}

export async function scanWave(runId: number, barcode: string, by: string, dept?: string | null) {
  await ensure();
  const code = barcode.trim();
  const run = (await q<WaveRun>("SELECT * FROM wave_runs WHERE id=$1", [runId]))[0];
  if (!run) return { ok: false as const, reason: "not_on_list", message: "Wave not found" };
  if (run.status === "finished") return { ok: false as const, reason: "finished", message: "This wave is finished" };
  const cands = await q<PickLine>("SELECT * FROM wave_lines WHERE run_id=$1 AND (barcode=$2 OR (sku<>'' AND sku=$2)) ORDER BY (picked < pick) DESC, id", [runId, code]);
  if (!cands.length) return { ok: false as const, reason: "not_on_list", message: "Not in this wave" };
  const inDept = dept ? cands.filter((c) => c.dept === dept) : cands;
  if (dept && !inDept.length) return { ok: false as const, reason: "wrong_dept", line: cands[0], message: `That's on the ${cands[0].dept} list` };
  const open = inDept.find((c) => c.picked < c.pick);
  if (!open) return { ok: false as const, reason: "already_picked", line: inDept[0], message: `Already picked ${inDept[0].picked} of ${inDept[0].pick}` };
  const [line] = await q<PickLine>("UPDATE wave_lines SET picked=picked+1, picked_by=$2, picked_at=now(), method=CASE WHEN method='skipped' OR method IS NULL THEN 'scan' ELSE method END WHERE id=$1 RETURNING *", [open.id, by]);
  return { ok: true as const, line, complete: line.picked >= line.pick };
}

export async function overrideWave(runId: number, lineId: number, action: "pick" | "undo" | "skip", by: string) {
  await ensure();
  const r = action === "pick"
    ? await q<PickLine>("UPDATE wave_lines SET picked=pick, picked_by=$3, picked_at=now(), method='manual' WHERE id=$1 AND run_id=$2 RETURNING *", [lineId, runId, by])
    : action === "skip"
    ? await q<PickLine>("UPDATE wave_lines SET picked_by=$3, picked_at=now(), method='skipped' WHERE id=$1 AND run_id=$2 RETURNING *", [lineId, runId, by])
    : await q<PickLine>("UPDATE wave_lines SET picked=0, picked_by=NULL, picked_at=NULL, method=NULL WHERE id=$1 AND run_id=$2 RETURNING *", [lineId, runId]);
  return r[0] || null;
}

export async function finishWave(id: number, by: string) {
  await ensure();
  const r = await q<WaveRun>("UPDATE wave_runs SET status='finished', finished_at=now(), finished_by=$2 WHERE id=$1 AND status='open' RETURNING *", [id, by]);
  return r[0] ? { ok: true, sent: 0, units: 0 } : { ok: false, sent: 0, units: 0, message: "Already finished" };
}

/** For the bench: what's in one order (by packing-slip barcode = order number). */
export async function orderInWave(number: string) {
  await ensure();
  const o = await q<{ wave_id: number; number: string; name: string; items_json: string }>("SELECT wave_id, number, name, items_json FROM wave_orders WHERE number=$1 OR number=$2 ORDER BY id DESC LIMIT 1", [number, "#" + number.replace(/^#/, "")]);
  if (!o[0]) return null;
  return { wave: o[0].wave_id, number: o[0].number, name: o[0].name, items: JSON.parse(o[0].items_json) as { sku: string; name: string; quantity: number }[] };
}
