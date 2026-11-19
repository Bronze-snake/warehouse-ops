import { createHash } from "crypto";
import { q, getSetting } from "./db";
import { resolveBarcodes, receiveIntoWarehouse, shopifyConfigured } from "./shopify";

export type Line = { barcode: string; qty: number; product: string; size: string; colour: string; sku: string; bin: string; status: "ok" | "noloc" | "unknown"; variant_id?: string; inventory_item_id?: string };
export type Batch = { id: number; created_at: string; created_by: string; fingerprint: string; lines: number; units: number; unknown_count: number; status: string; received_at: string | null; received_by: string | null; shopify_ref: string | null; error: string | null };

const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "XS/S", "S/M", "M/L", "L/XL", "OSFM", "One size"];
export function sizeIdx(s: string) { const i = SIZE_ORDER.indexOf(s); if (i >= 0) return i; const n = parseFloat(s); return isNaN(n) ? 999 : 100 + n; }

/** Bin walk order: split "A13R4" into letters/numbers so A2 < A13 and aisle A before B. */
export function binSort(a: string, b: string) {
  const tok = (s: string) => String(s).toUpperCase().match(/[A-Z]+|\d+/g) || [];
  const ta = tok(a), tb = tok(b);
  for (let i = 0; i < Math.max(ta.length, tb.length); i++) {
    if (ta[i] === undefined) return -1; if (tb[i] === undefined) return 1;
    const na = /^\d+$/.test(ta[i]), nb = /^\d+$/.test(tb[i]);
    if (na && nb) { const d = Number(ta[i]) - Number(tb[i]); if (d) return d; }
    else if (ta[i] !== tb[i]) return ta[i] < tb[i] ? -1 : 1;
  }
  return 0;
}

/** Parse a scan: CSV text (Barcode,Quantity with or without header) or a pasted list. Returns barcode -> qty. */
export function parseScan(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  const rows = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of rows) {
    const cells = line.split(/[,\t;]/).map((c) => c.trim().replace(/^"|"$/g, ""));
    const code = cells[0].replace(/\.0$/, "");
    if (!code || !/^[A-Za-z0-9._-]+$/.test(code)) continue; // header or junk
    const qty = cells.length > 1 ? Number(cells[1]) : 1;
    if (!isFinite(qty) || qty <= 0) continue;
    out[code] = (out[code] || 0) + qty;
  }
  return out;
}

export function fingerprint(scan: Record<string, number>) {
  const s = Object.keys(scan).sort().map((k) => `${k}:${scan[k]}`).join("|");
  return createHash("sha256").update(s).digest("hex").slice(0, 32);
}

export async function buildBatch(scan: Record<string, number>, createdBy: string): Promise<{ batch: Batch; lines: Line[]; duplicateOf: Batch | null }> {
  const codes = Object.keys(scan);
  const info = await resolveBarcodes(codes);
  const skus = Object.values(info).map((v) => v.sku).filter(Boolean);
  const binRows = skus.length ? await q<{ sku: string; bin: string }>("SELECT sku, bin FROM bins WHERE sku = ANY($1)", [skus]) : [];
  const bins: Record<string, string> = {}; for (const b of binRows) bins[b.sku] = b.bin;
  const lines: Line[] = codes.map((c) => {
    const v = info[c];
    if (!v) return { barcode: c, qty: scan[c], product: "", size: "", colour: "", sku: "", bin: "", status: "unknown" };
    const bin = bins[v.sku] || "";
    return { barcode: c, qty: scan[c], product: v.product, size: v.size, colour: v.colour, sku: v.sku, bin, status: bin ? "ok" : "noloc", variant_id: v.variant_id, inventory_item_id: v.inventory_item_id };
  });
  const fp = fingerprint(scan);
  const dup = await q<Batch>("SELECT * FROM putaway_batches WHERE fingerprint=$1 AND status='received' AND created_at > now() - interval '48 hours' ORDER BY id DESC LIMIT 1", [fp]);
  const units = lines.reduce((a, l) => a + l.qty, 0);
  const [batch] = await q<Batch>(
    "INSERT INTO putaway_batches(created_by, fingerprint, lines, units, unknown_count, status) VALUES($1,$2,$3,$4,$5,'built') RETURNING *",
    [createdBy, fp, lines.length, units, lines.filter((l) => l.status === "unknown").length]
  );
  for (const l of lines) {
    await q("INSERT INTO putaway_lines(batch_id,barcode,qty,variant_id,inventory_item_id,sku,product,size,colour,bin,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [batch.id, l.barcode, l.qty, l.variant_id || null, l.inventory_item_id || null, l.sku, l.product, l.size, l.colour, l.bin, l.status]);
  }
  return { batch, lines: sortLines(lines), duplicateOf: dup[0] || null };
}

export function sortLines(lines: Line[]) {
  const ok = lines.filter((l) => l.status === "ok").sort((a, b) => binSort(a.bin, b.bin) || a.product.localeCompare(b.product) || sizeIdx(a.size) - sizeIdx(b.size));
  const noloc = lines.filter((l) => l.status === "noloc").sort((a, b) => a.product.localeCompare(b.product) || sizeIdx(a.size) - sizeIdx(b.size));
  const unk = lines.filter((l) => l.status === "unknown");
  return [...ok, ...noloc, ...unk];
}

export async function getBatch(id: number): Promise<{ batch: Batch; lines: Line[] } | null> {
  const b = await q<Batch>("SELECT * FROM putaway_batches WHERE id=$1", [id]);
  if (!b[0]) return null;
  const lines = await q<Line>("SELECT barcode, qty, product, size, colour, sku, bin, status, variant_id, inventory_item_id FROM putaway_lines WHERE batch_id=$1", [id]);
  return { batch: b[0], lines: sortLines(lines) };
}

export async function listBatches(limit = 50): Promise<Batch[]> {
  return q<Batch>("SELECT * FROM putaway_batches ORDER BY id DESC LIMIT $1", [limit]);
}

/** Post the batch's known lines to Shopify as +qty at Online Warehouse. Refuses a repeat of a received batch and a batch already received. */
export async function receiveBatch(id: number, by: string, force = false): Promise<{ ok: true; ref: string; units: number } | { ok: false; reason: string; duplicateOf?: Batch }> {
  const got = await getBatch(id);
  if (!got) return { ok: false, reason: "Batch not found" };
  const { batch, lines } = got;
  if (batch.status === "received") return { ok: false, reason: `Already received at ${fmt(batch.received_at)} by ${batch.received_by || "?"}` };
  if (!shopifyConfigured()) return { ok: false, reason: "Shopify is not configured on the server" };
  const dup = await q<Batch>("SELECT * FROM putaway_batches WHERE fingerprint=$1 AND status='received' AND id<>$2 AND created_at > now() - interval '48 hours' ORDER BY id DESC LIMIT 1", [batch.fingerprint, id]);
  if (dup[0] && !force) return { ok: false, reason: `An identical scan was already received at ${fmt(dup[0].received_at)} by ${dup[0].received_by || "?"} (batch #${dup[0].id}).`, duplicateOf: dup[0] };
  const post = lines.filter((l) => l.status !== "unknown" && l.inventory_item_id);
  if (!post.length) return { ok: false, reason: "Nothing to receive – no known barcodes in this batch" };
  // merge by inventory item (two barcodes can't share one, but be safe)
  const merged: Record<string, number> = {};
  for (const l of post) merged[l.inventory_item_id!] = (merged[l.inventory_item_id!] || 0) + l.qty;
  await q("UPDATE putaway_batches SET status='receiving', received_by=$2 WHERE id=$1", [id, by]);
  try {
    const ref = await receiveIntoWarehouse(Object.entries(merged).map(([inventory_item_id, qty]) => ({ inventory_item_id, qty })), `${process.env.NEXT_PUBLIC_SITE_URL || "ops"}/putaway/${id}`);
    await q("UPDATE putaway_batches SET status='received', received_at=now(), received_by=$2, shopify_ref=$3, error=NULL WHERE id=$1", [id, by, ref]);
    return { ok: true, ref, units: post.reduce((a, l) => a + l.qty, 0) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await q("UPDATE putaway_batches SET status='error', error=$2 WHERE id=$1", [id, msg]);
    return { ok: false, reason: "Shopify refused the adjustment – nothing was changed: " + msg };
  }
}

export function fmt(ts: string | null | undefined) {
  if (!ts) return "";
  return new Date(ts).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export async function locationMasterInfo() {
  const [c] = await q<{ n: string }>("SELECT count(*)::text AS n FROM bins");
  const at = await getSetting("bins_uploaded_at");
  const name = await getSetting("bins_file");
  return { count: Number(c?.n || 0), uploadedAt: at, file: name };
}
