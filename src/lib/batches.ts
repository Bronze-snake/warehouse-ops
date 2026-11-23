// Morning batching: split the ShipStation queue into print batches that are short walks.
// Each batch is ONE carrier (never mix Australia Post with DHL). Within a carrier: singles sorted by bin then SKU, multis grouped by aisle.
// ShipStation v1 (orders) is used when its key/secret are set – its tags show in the Orders grid. Otherwise v2 (shipments) as a fallback.
// Writes to ShipStation: only adding tags BATCH-01..BATCH-NN (and removing those same tags when asked to re-plan). Nothing else.
import { q, getSetting, setSetting } from "./db";
import { listPending, tagShipments, untagShipments, shipstationConfigured, type SSShipment } from "./shipstation";
import { v1Configured, listAwaiting, tagIdFor, addTag, removeTag, PACE_MS } from "./shipstation-v1";
import { binSort } from "./putaway";

export const BATCH_PREFIX = "BATCH-";
// Orders carrying any of these tags are left alone (the team handles them another way). Override with SHIPSTATION_SKIP_TAGS="a,b,c".
const DEFAULT_SKIP = ["Fitzroy", "Glenelg", "Prahran", "Newtown", "Split", "5411", "Same Day", "Local Pickup", "Locals"];
// Orders with these tags get their own batches (2-page packing lists etc). Override with SHIPSTATION_SEPARATE_TAGS.
const DEFAULT_SEPARATE = ["More Than 6"];
const listEnv = (k: string, d: string[]) => (process.env[k] ? process.env[k]!.split(",").map((x) => x.trim()).filter(Boolean) : d);
const hasTag = (o: SSShipment, wanted: string[]) => wanted.find((w) => o.tags.some((t) => t.toLowerCase().includes(w.toLowerCase())));

export type PlannedBatch = { tag: string; kind: "Singles" | "Multis" | "Big orders"; carrier: string; orders: SSShipment[]; units: number; skus: number; bins: string[]; aisles: string };
export type Plan = { batches: PlannedBatch[]; queue: number; singles: number; multis: number; big: number; untagged: number; alreadyTagged: number; noBin: number; skipped: Record<string, number>; plannedAt: string; api: "v1" | "v2" };

function aisleOf(bin: string) { const m = String(bin).toUpperCase().match(/^[A-Z]+\d*/); return m ? m[0] : ""; }
function pad(n: number) { return String(n).padStart(2, "0"); }
export function usingV1() { return v1Configured(); }

async function fetchQueue(): Promise<SSShipment[]> {
  if (v1Configured()) return listAwaiting(3000, /^(WAVE)-/i);
  if (shipstationConfigured()) return listPending(2000, /^(WAVE)-/i);
  throw new Error("ShipStation isn't connected on this server (SHIPSTATION_V1_KEY + SHIPSTATION_V1_SECRET)");
}

async function binsForSkus(skus: string[]): Promise<Record<string, string>> {
  const want = [...new Set(skus.filter(Boolean))];
  const rows = want.length ? await q<{ sku: string; bin: string }>("SELECT sku, bin FROM bins WHERE sku = ANY($1)", [want]) : [];
  const m: Record<string, string> = {}; for (const r of rows) m[r.sku] = r.bin; return m;
}

/** Plan the batches for everything awaiting shipment that isn't already in a BATCH-* tag. Read-only. */
export async function planBatches(singleSize = 40, multiSize = 20, expressFirst = true): Promise<Plan> {
  const all = await fetchQueue();
  const notBatched = all.filter((s) => !s.tags.some((t) => t.toUpperCase().startsWith(BATCH_PREFIX)));
  const alreadyTagged = all.length - notBatched.length;
  const SKIP = listEnv("SHIPSTATION_SKIP_TAGS", DEFAULT_SKIP), SEP = listEnv("SHIPSTATION_SEPARATE_TAGS", DEFAULT_SEPARATE);
  const skipped: Record<string, number> = {};
  const pending: SSShipment[] = [];
  for (const o of notBatched) { const w = hasTag(o, SKIP); if (w) skipped[w] = (skipped[w] || 0) + 1; else pending.push(o); }
  const bigOrders = pending.filter((o) => hasTag(o, SEP));
  const normal = pending.filter((o) => !hasTag(o, SEP));
  const bins = await binsForSkus(pending.flatMap((o) => o.items.map((i) => i.sku)));
  const binOf = (sku: string, fallback?: string) => bins[sku] || fallback || "";
  const itemBin = (o: SSShipment, i: number) => binOf(o.items[i].sku, o.items[i].bin);
  const isExpress = (o: SSShipment) => /express|priority|overnight|same.?day/i.test(o.service_code || "");

  const singles = normal.filter((o) => o.units === 1 && o.items.length === 1);
  singles.sort((a, b) => (expressFirst ? Number(isExpress(b)) - Number(isExpress(a)) : 0) || (itemBin(a, 0) ? 0 : 1) - (itemBin(b, 0) ? 0 : 1) || binSort(itemBin(a, 0), itemBin(b, 0)) || a.items[0].sku.localeCompare(b.items[0].sku) || a.created_at.localeCompare(b.created_at));
  const multis = normal.filter((o) => !(o.units === 1 && o.items.length === 1) && o.items.length > 0);
  const anchor = (o: SSShipment) => o.items.map((i) => binOf(i.sku, i.bin)).filter(Boolean).sort(binSort)[0] || "";
  multis.sort((a, b) => (expressFirst ? Number(isExpress(b)) - Number(isExpress(a)) : 0) || (anchor(a) ? 0 : 1) - (anchor(b) ? 0 : 1) || binSort(anchor(a), anchor(b)) || a.created_at.localeCompare(b.created_at));

  const batches: PlannedBatch[] = []; let n = 0;
  const chunk = (list: SSShipment[], size: number, kind: PlannedBatch["kind"], carrier: string) => {
    for (let i = 0; i < list.length; i += size) {
      const orders = list.slice(i, i + size); n++;
      const allBins = [...new Set(orders.flatMap((o) => o.items.map((it) => binOf(it.sku, it.bin))).filter(Boolean))].sort(binSort);
      const aisles = [...new Set(allBins.map(aisleOf))];
      batches.push({ tag: BATCH_PREFIX + pad(n), kind, carrier, orders, units: orders.reduce((a, o) => a + o.units, 0), skus: new Set(orders.flatMap((o) => o.items.map((it) => it.sku))).size, bins: allBins, aisles: aisles.length > 6 ? `${aisles[0]} … ${aisles[aisles.length - 1]} (${aisles.length} aisles)` : aisles.join(", ") });
    }
  };
  const carriers = [...new Set(pending.map((o) => o.carrier))].sort((a, b) => pending.filter((o) => o.carrier === b).length - pending.filter((o) => o.carrier === a).length || a.localeCompare(b));
  for (const c of carriers) {
    chunk(singles.filter((o) => o.carrier === c), Math.max(5, singleSize), "Singles", c);
    chunk(multis.filter((o) => o.carrier === c), Math.max(3, multiSize), "Multis", c);
  }
  bigOrders.sort((a, b) => binSort(anchor(a), anchor(b)) || a.created_at.localeCompare(b.created_at));
  for (const c of carriers) chunk(bigOrders.filter((o) => o.carrier === c), Math.max(3, multiSize), "Big orders", c);
  const noBin = pending.filter((o) => o.items.some((i) => !binOf(i.sku, i.bin))).length;
  return { batches, queue: all.length, singles: singles.length, multis: multis.length, big: bigOrders.length, untagged: pending.length, alreadyTagged, noBin, skipped, plannedAt: new Date().toISOString(), api: v1Configured() ? "v1" : "v2" };
}

const RUNS_SQL = `CREATE TABLE IF NOT EXISTS batch_runs (id serial PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL DEFAULT '', batches integer NOT NULL, orders integer NOT NULL, tagged integer NOT NULL, failed integer NOT NULL, summary text NOT NULL DEFAULT '')`;

type Job = { kind: "tag" | "clear"; by: string; items: { id: string; tag: string }[]; done: number; failed: number; total: number; batches: number; summary: string; missingTags?: string[] };
const JOB_KEY = "batch_job";

/** Start a tagging job from a fresh plan. Returns the job; the browser then calls stepJob() until finished. */
export async function startTagJob(plan: Plan, by: string): Promise<Job> {
  await q(RUNS_SQL);
  const items = plan.batches.flatMap((b) => b.orders.map((o) => ({ id: o.shipment_id, tag: b.tag })));
  const job: Job = { kind: "tag", by, items, done: 0, failed: 0, total: items.length, batches: plan.batches.length, summary: plan.batches.map((b) => `${b.tag} ${b.carrier} · ${b.kind} ${b.orders.length} orders / ${b.units} units · ${b.aisles}`).join("\n") };
  if (v1Configured()) {
    const missing: string[] = [];
    for (const t of new Set(items.map((i) => i.tag))) if (!(await tagIdFor(t))) missing.push(t);
    if (missing.length) { job.missingTags = missing; job.items = []; job.total = 0; }
  }
  await setSetting(JOB_KEY, JSON.stringify(job));
  return job;
}

/** Start a job that removes BATCH-* tags from every order still awaiting shipment. */
export async function startClearJob(by: string): Promise<Job> {
  const all = await fetchQueue();
  const items = all.flatMap((o) => o.tags.filter((t) => t.toUpperCase().startsWith(BATCH_PREFIX)).map((t) => ({ id: o.shipment_id, tag: t })));
  const job: Job = { kind: "clear", by, items, done: 0, failed: 0, total: items.length, batches: 0, summary: "" };
  await setSetting(JOB_KEY, JSON.stringify(job));
  return job;
}

/** Do up to `budgetMs` of paced tag writes, save progress, return it. Finished when done+failed == total. */
export async function stepJob(budgetMs = 45000): Promise<Job | null> {
  const raw = await getSetting(JOB_KEY); if (!raw) return null;
  const job = JSON.parse(raw) as Job;
  const start = Date.now();
  const ids: Record<string, number> = {};
  while (job.done + job.failed < job.total && Date.now() - start < budgetMs) {
    const it = job.items[job.done + job.failed];
    try {
      if (v1Configured()) {
        if (!(it.tag in ids)) ids[it.tag] = (await tagIdFor(it.tag)) || 0;
        if (!ids[it.tag]) throw new Error("tag missing");
        if (job.kind === "tag") await addTag(Number(it.id), ids[it.tag]); else await removeTag(Number(it.id), ids[it.tag]);
        await new Promise((r) => setTimeout(r, PACE_MS));
      } else {
        if (job.kind === "tag") { const r = await tagShipments([it.id], it.tag); if (r.failed.length) throw new Error("v2 tag failed"); }
        else await untagShipments([it.id], it.tag);
      }
      job.done++;
    } catch { job.failed++; }
    await setSetting(JOB_KEY, JSON.stringify(job));
  }
  if (job.done + job.failed >= job.total && job.kind === "tag" && job.total > 0) {
    await q(RUNS_SQL);
    await q("INSERT INTO batch_runs(created_by, batches, orders, tagged, failed, summary) VALUES($1,$2,$3,$4,$5,$6)", [job.by, job.batches, job.total, job.done, job.failed, job.summary]);
    job.summary = ""; // don't log twice if stepped again
    await setSetting(JOB_KEY, JSON.stringify(job));
  }
  return job;
}

export async function lastBatchRuns(limit = 10) {
  await q(RUNS_SQL);
  return q<{ id: number; created_at: string; created_by: string; batches: number; orders: number; tagged: number; failed: number; summary: string }>("SELECT * FROM batch_runs ORDER BY id DESC LIMIT $1", [limit]);
}
