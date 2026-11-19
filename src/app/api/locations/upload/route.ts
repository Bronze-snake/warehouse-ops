import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { q, setSetting } from "@/lib/db";
export const runtime = "nodejs";
// ShipStation export: needs a SKU column and a column whose header contains "location" (WarehouseLocation).
export async function POST(req: Request) {
  const user = await currentUser(); if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const form = await req.formData();
  const file = form.get("file"); if (!file || typeof file === "string") return NextResponse.json({ error: "No file" }, { status: 400 });
  const text = await file.text();
  const rows = parseCsv(text);
  if (rows.length < 2) return NextResponse.json({ error: "Empty file" }, { status: 400 });
  const hdr = rows[0].map((h) => h.trim().toLowerCase());
  const si = hdr.indexOf("sku"), li = hdr.findIndex((h) => h === "warehouselocation" || h.includes("location"));
  if (si < 0 || li < 0) return NextResponse.json({ error: "Need SKU and WarehouseLocation columns. Found: " + rows[0].join(", ") }, { status: 400 });
  const pairs: [string, string][] = [];
  for (const r of rows.slice(1)) { const s = (r[si] || "").trim(), b = (r[li] || "").trim(); if (s && b) pairs.push([s, b]); }
  await q("DELETE FROM bins");
  for (let i = 0; i < pairs.length; i += 500) {
    const chunk = pairs.slice(i, i + 500);
    const values = chunk.map((_, j) => `($${j * 2 + 1},$${j * 2 + 2},now())`).join(",");
    await q(`INSERT INTO bins(sku,bin,updated_at) VALUES ${values} ON CONFLICT(sku) DO UPDATE SET bin=EXCLUDED.bin, updated_at=now()`, chunk.flat());
  }
  await setSetting("bins_uploaded_at", new Date().toISOString());
  await setSetting("bins_file", `${file.name} (${user})`);
  return NextResponse.redirect(new URL("/locations?ok=" + pairs.length, req.url), 303);
}
function parseCsv(text: string): string[][] {
  const out: string[][] = []; let row: string[] = [], cell = "", inq = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inq) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inq = false; } else cell += ch; }
    else if (ch === '"') inq = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); out.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out.filter((r) => r.some((c) => c.trim()));
}
