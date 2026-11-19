import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { q, setSetting } from "@/lib/db";
export const runtime = "nodejs";
// The browser parses the ShipStation CSV and posts only SKU + bin pairs, in chunks, so the request stays small.
// Body: { mode: "start" | "append" | "finish", rows?: [sku, bin][], file?: string, total?: number }
export async function POST(req: Request) {
  const user = await currentUser(); if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = (await req.json()) as { mode: string; rows?: [string, string][]; file?: string; total?: number };
  if (body.mode === "start") { await q("DELETE FROM bins"); return NextResponse.json({ ok: true }); }
  if (body.mode === "append") {
    const rows = (body.rows || []).filter((r) => r[0] && r[1]);
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const values = chunk.map((_, j) => `($${j * 2 + 1},$${j * 2 + 2},now())`).join(",");
      await q(`INSERT INTO bins(sku,bin,updated_at) VALUES ${values} ON CONFLICT(sku) DO UPDATE SET bin=EXCLUDED.bin, updated_at=now()`, chunk.flat());
    }
    return NextResponse.json({ ok: true, n: rows.length });
  }
  if (body.mode === "finish") {
    await setSetting("bins_uploaded_at", new Date().toISOString());
    await setSetting("bins_file", `${body.file || "upload"} (${user})`);
    return NextResponse.json({ ok: true, total: body.total || 0 });
  }
  return NextResponse.json({ error: "bad mode" }, { status: 400 });
}
