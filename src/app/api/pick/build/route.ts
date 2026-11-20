import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { createRun, rebuildRun, STORES, type StoreKey } from "@/lib/picklist";
import { shopifyConfigured } from "@/lib/shopify";
export const runtime = "nodejs";
export const maxDuration = 300;

// POST { store: "f"|"p"|"g"|"n", from?: "YYYY-MM-DD", to?: "YYYY-MM-DD", force?: boolean }
export async function POST(req: Request) {
  const user = await currentUser(); if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!shopifyConfigured()) return NextResponse.json({ error: "Shopify isn't connected on this server" }, { status: 503 });
  const b = (await req.json()) as { store?: string; from?: string; to?: string; force?: boolean; runId?: number };
  if (b.runId) {
    try { const run = await rebuildRun(Number(b.runId), user); return NextResponse.json({ id: run.id, existing: false, run }); }
    catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
  }
  if (!STORES.some((s) => s.key === b.store)) return NextResponse.json({ error: "Pick a store" }, { status: 400 });
  try {
    const r = await createRun(b.store as StoreKey, b.from || null, b.to || null, user, !!b.force);
    return NextResponse.json({ id: r.run.id, existing: r.existing, run: r.run });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}
