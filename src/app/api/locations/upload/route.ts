import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { q, setSetting } from "@/lib/db";
export const runtime = "nodejs";
export const maxDuration = 60;
// The browser parses the ShipStation CSV and posts only SKU + bin pairs, in chunks, so the request stays small.
// Body: { mode: "start" | "append" | "finish", rows?: [sku, bin, name?][], file?: string, total?: number }
export async function POST(req: Request) {
  const user = await currentUser(); if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  try {
  const body = (await req.json()) as { mode: string; rows?: [string, string, string?][]; file?: string; total?: number };
  if (body.mode === "start") { await q("DELETE FROM bins"); return NextResponse.json({ ok: true }); }
  if (body.mode === "append") {
    const m = new Map<string, [string, string]>();
    for (const r of body.rows || []) if (r[0] && r[1]) m.set(String(r[0]).trim(), [String(r[1]).trim(), String(r[2] || "").trim().slice(0, 200)]);
    const rows = [...m.entries()].map(([sku, [bin, name]]) => [sku, bin, name]);
    for (let i = 0; i < rows.length; i += 250) {
      const chunk = rows.slice(i, i + 250);
      const values = chunk.map((_, j) => `($${j * 3 + 1},$${j * 3 + 2},$${j * 3 + 3},now())`).join(",");
      await q(`INSERT INTO bins(sku,bin,name,updated_at) VALUES ${values} ON CONFLICT(sku) DO UPDATE SET bin=EXCLUDED.bin, name=EXCLUDED.name, updated_at=now()`, chunk.flat());
    }
    return NextResponse.json({ ok: true, n: rows.length });
  }
  if (body.mode === "finish") {
    await setSetting("bins_uploaded_at", new Date().toISOString());
    await setSetting("bins_file", `${body.file || "upload"} (${user})`);
    return NextResponse.json({ ok: true, total: body.total || 0 });
  }
  return NextResponse.json({ error: "bad mode" }, { status: 400 });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}
