import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { buildReplen, windowFor } from "@/lib/replen";
import { shopifyConfigured } from "@/lib/shopify";
import { q } from "@/lib/db";
export const runtime = "nodejs";
export const maxDuration = 300;

// GET /api/replen?day=YYYY-MM-DD (run day; default today). Cached per window for 10 minutes.
export async function GET(req: Request) {
  const user = await currentUser(); if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!shopifyConfigured()) return NextResponse.json({ error: "Shopify isn't connected on this server" }, { status: 503 });
  const u = new URL(req.url);
  const day = u.searchParams.get("day"); const fresh = u.searchParams.get("fresh") === "1";
  const runDay = day ? new Date(day + "T12:00:00+11:00") : new Date();
  const win = windowFor(runDay);
  const key = "replen:" + win.start.toISOString() + "|" + win.end.toISOString();
  if (!fresh) {
    const c = await q<{ value: string; updated_at: string }>("SELECT value, updated_at FROM settings WHERE key=$1", [key]);
    if (c[0] && Date.now() - new Date(c[0].updated_at).getTime() < 10 * 60e3) return NextResponse.json({ ...JSON.parse(c[0].value), cached: true });
  }
  try {
    const r = await buildReplen(win);
    const payload = { window: win.label, start: win.start, end: win.end, ...r, builtAt: new Date().toISOString() };
    await q("INSERT INTO settings(key,value,updated_at) VALUES($1,$2,now()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()", [key, JSON.stringify(payload)]);
    return NextResponse.json(payload);
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}
