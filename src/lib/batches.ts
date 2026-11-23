// Morning batching: split the ShipStation queue into print batches that are short walks.
// Each batch is ONE carrier (never mix Australia Post with DHL). Within a carrier: singles sorted by bin then SKU, multis grouped by aisle.
// Writes to ShipStation: only adding tags BATCH-01..BATCH-NN (and removing those same tags when asked to re-plan). Nothing else.
import { q } from "./db";
import { listPending, tagShipments, untagShipments, shipstationConfigured, type SSShipment } from "./shipstation";
import { binSort } from "./putaway";

export const BATCH_PREFIX = "BATCH-";
// Orders carrying any of these tags are left alone (the team handles them another way). Override with SHIPSTATION_SKIP_TAGS="a,b,c".
const DEFAULT_SKIP = ["Fitzroy", "Glenelg", "Prahran", "Newtown", "Split", "5411", "Same Day", "Local Pickup"];
// Orders with these tags get their own batches (2-page packing lists etc). Override with SHIPSTATION_SEPARATE_TAGS.
const DEFAULT_SEPARATE = ["More Than 6"];
const listEnv = (k: string, d: string[]) => (process.env[k] ? process.env[k]!.split(",").map((x) => x.trim()).filter(Boolean) : d);
const hasTag = (o: SSShipment, wanted: string[]) => wanted.find((w) => o.tags.some((t) => t.toLowerCase().includes(w.toLowerCase())));

export type PlannedBatch = { tag: string; kind: "Singles" | "Multis" | "Big orders"; carrier: string; orders: SSShipment[]; units: number; skus: number; bins: string[]; aisles: string };
export type Plan = { batches: PlannedBatch[]; queue: number; singles: number; multis: number; big: number; untagged: number; alreadyTagged: number; noBin: number; skipped: Record<string, number>; plannedAt: string };

function aisleOf(bin: string) { const m = String(bin).toUpperCase().match(/^[A-Z]+\d*/); return m ? m[0] : ""; }
function pad(n: number) { return String(n).padStart(2, "0"); }

async function binsForSkus(skus: string[]): Promise<Record<string, string>> {
  const want = [...new Set(skus.filter(Boolean))];
  const rows = want.length ? await q<{ sku: string; bin: string }>("SELECT sku, bin FROM bins WHERE sku = ANY($1)", [want]) : [];
  const m: Record<string, string> = {}; for (const r of rows) m[r.sku] = r.bin; return m;
}

/** Plan the batches for everything currently awaiting shipment that isn't already in a BATCH-* tag. Read-only. */
export async function planBatches(singleSize = 40, multiSize = 20, expressFirst = true): Promise<Plan> {
  if (!shipstationConfigured()) throw new Error("ShipStation isn't connected on this server (SHIPSTATION_API_KEY)");
  const all = await listPending(2000, /^(WAVE|BATCH)-/i);
  const notBatched = all.filter((s) => !s.tags.some((t) => t.toUpperCase().startsWith(BATCH_PREFIX)));
  const alreadyTagged = all.length - notBatched.length;
  const SKIP = listEnv("SHIPSTATION_SKIP_TAGS", DEFAULT_SKIP), SEP = listEnv("SHIPSTATION_SEPARATE_TAGS", DEFAULT_SEPARATE);
  const skipped: Record<string, number> = {};
  const pending: SSShipment[] = [];
  for (const o of notBatched) { const w = hasTag(o, SKIP); if (w) skipped[w] = (skipped[w] || 0) + 1; else pending.push(o); }
  const bigOrders = pending.filter((o) => hasTag(o, SEP));
  const normal = pending.filter((o) => !hasTag(o, SEP));
  const bins = await binsForSkus(pending.flatMap((o) => o.items.map((i) => i.sku)));
  const binOf = (sku: string) => bins[sku] || "";
  const isExpress = (o: SSShipment) => /express|priority|overnight|same.?day/i.test(o.service_code || "");

  // singles: one unit per order → sort by bin, then SKU so identical items are adjacent, then oldest
  const singles = normal.filter((o) => o.units === 1 && o.items.length === 1);
  singles.sort((a, b) => (expressFirst ? Number(isExpress(b)) - Number(isExpress(a)) : 0) || (binOf(a.items[0].sku) ? 0 : 1) - (binOf(b.items[0].sku) ? 0 : 1) || binSort(binOf(a.items[0].sku), binOf(b.items[0].sku)) || a.items[0].sku.localeCompare(b.items[0].sku) || a.created_at.localeCompare(b.created_at));
  // multis: place each order at its first bin in walk order; sort orders by that, so a batch stays within a few aisles
  const multis = normal.filter((o) => !(o.units === 1 && o.items.length === 1) && o.items.length > 0);
  const anchor = (o: SSShipment) => o.items.map((i) => binOf(i.sku)).filter(Boolean).sort(binSort)[0] || "";
  multis.sort((a, b) => (expressFirst ? Number(isExpress(b)) - Number(isExpress(a)) : 0) || (anchor(a) ? 0 : 1) - (anchor(b) ? 0 : 1) || binSort(anchor(a), anchor(b)) || a.created_at.localeCompare(b.created_at));

  const batches: PlannedBatch[] = []; let n = 0;
  const chunk = (list: SSShipment[], size: number, kind: PlannedBatch["kind"], carrier: string) => {
    for (let i = 0; i < list.length; i += size) {
      const orders = list.slice(i, i + size); n++;
      const allBins = [...new Set(orders.flatMap((o) => o.items.map((i) => binOf(i.sku))).filter(Boolean))].sort(binSort);
      const aisles = [...new Set(allBins.map(aisleOf))];
      batches.push({ tag: BATCH_PREFIX + pad(n), kind, carrier, orders, units: orders.reduce((a, o) => a + o.units, 0), skus: new Set(orders.flatMap((o) => o.items.map((i) => i.sku))).size, bins: allBins, aisles: aisles.length > 6 ? `${aisles[0]} … ${aisles[aisles.length - 1]} (${aisles.length} aisles)` : aisles.join(", ") });
    }
  };
  // one carrier per batch: biggest carrier first (that's the main run), then the rest
  const carriers = [...new Set(pending.map((o) => o.carrier))].sort((a, b) => pending.filter((o) => o.carrier === b).length - pending.filter((o) => o.carrier === a).length || a.localeCompare(b));
  for (const c of carriers) {
    chunk(singles.filter((o) => o.carrier === c), Math.max(5, singleSize), "Singles", c);
    chunk(multis.filter((o) => o.carrier === c), Math.max(3, multiSize), "Multis", c);
  }
  // big orders (2-page packing lists) last, still one carrier per batch
  bigOrders.sort((a, b) => binSort(anchor(a), anchor(b)) || a.created_at.localeCompare(b.created_at));
  for (const c of carriers) chunk(bigOrders.filter((o) => o.carrier === c), Math.max(3, multiSize), "Big orders", c);
  const noBin = pending.filter((o) => o.items.some((i) => !binOf(i.sku))).length;
  return { batches, queue: all.length, singles: singles.length, multis: multis.length, big: bigOrders.length, untagged: pending.length, alreadyTagged, noBin, skipped, plannedAt: new Date().toISOString() };
}

/** Apply the plan: tag every order with its batch. Records the run in batch_runs. */
export async function applyBatches(plan: Plan, by: string): Promise<{ tagged: number; failed: number; batches: number }> {
  await q(`CREATE TABLE IF NOT EXISTS batch_runs (id serial PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL DEFAULT '', batches integer NOT NULL, orders integer NOT NULL, tagged integer NOT NULL, failed integer NOT NULL, summary text NOT NULL DEFAULT '')`);
  let tagged = 0, failed = 0;
  for (const b of plan.batches) {
    const r = await tagShipments(b.orders.map((o) => o.shipment_id), b.tag);
    tagged += r.tagged; failed += r.failed.length;
  }
  const summary = plan.batches.map((b) => `${b.tag} ${b.carrier} · ${b.kind} ${b.orders.length} orders / ${b.units} units · ${b.aisles}`).join("\n");
  await q("INSERT INTO batch_runs(created_by, batches, orders, tagged, failed, summary) VALUES($1,$2,$3,$4,$5,$6)", [by, plan.batches.length, plan.batches.reduce((a, b) => a + b.orders.length, 0), tagged, failed, summary]);
  return { tagged, failed, batches: plan.batches.length };
}

/** Re-plan: remove BATCH-* tags from orders still awaiting shipment (shipped ones keep theirs – harmless). */
export async function clearBatchTags(): Promise<{ cleared: number }> {
  const all = await listPending(2000, /^WAVE-/i);
  let cleared = 0;
  for (const o of all) for (const t of o.tags) if (t.toUpperCase().startsWith(BATCH_PREFIX)) { if (await untagShipments([o.shipment_id], t)) cleared++; }
  return { cleared };
}

export async function lastBatchRuns(limit = 10) {
  await q(`CREATE TABLE IF NOT EXISTS batch_runs (id serial PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL DEFAULT '', batches integer NOT NULL, orders integer NOT NULL, tagged integer NOT NULL, failed integer NOT NULL, summary text NOT NULL DEFAULT '')`);
  return q<{ id: number; created_at: string; created_by: string; batches: number; orders: number; tagged: number; failed: number; summary: string }>("SELECT * FROM batch_runs ORDER BY id DESC LIMIT $1", [limit]);
}
