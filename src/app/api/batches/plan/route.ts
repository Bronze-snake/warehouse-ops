import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { planBatches, lastBatchRuns, usingV1 } from "@/lib/batches";
export const runtime = "nodejs"; export const maxDuration = 120;
// GET ?singles=40&multis=20&express=1 – read-only plan of today's print batches
export async function GET(req: Request) {
  const user = await currentUser(); if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const u = new URL(req.url);
  try {
    const plan = await planBatches(Number(u.searchParams.get("singles") || 40), Number(u.searchParams.get("multis") || 20), u.searchParams.get("express") !== "0");
    const lite = { ...plan, batches: plan.batches.map((b) => ({ tag: b.tag, kind: b.kind, carrier: b.carrier, count: b.orders.length, units: b.units, skus: b.skus, aisles: b.aisles, sample: b.orders.slice(0, 3).map((o) => o.shipment_number) })) };
    return NextResponse.json({ plan: lite, taggingEnabled: process.env.SHIPSTATION_TAGGING === "1", api: usingV1() ? "v1" : "v2", runs: await lastBatchRuns(5) });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}
