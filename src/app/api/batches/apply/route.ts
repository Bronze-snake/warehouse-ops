import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { planBatches, applyBatches } from "@/lib/batches";
export const runtime = "nodejs"; export const maxDuration = 300;
// POST { singles, multis, express } – re-plans from the live queue and tags. Only with SHIPSTATION_TAGGING=1.
export async function POST(req: Request) {
  const user = await currentUser(); if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (process.env.SHIPSTATION_TAGGING !== "1") return NextResponse.json({ error: "Tagging is switched off on this server (SHIPSTATION_TAGGING)" }, { status: 403 });
  const b = (await req.json()) as { singles?: number; multis?: number; express?: boolean };
  try {
    const plan = await planBatches(Number(b.singles || 40), Number(b.multis || 20), b.express !== false);
    if (!plan.batches.length) return NextResponse.json({ error: "Nothing to batch – every order awaiting shipment already has a BATCH tag" }, { status: 409 });
    const r = await applyBatches(plan, user);
    return NextResponse.json({ ...r, batchesList: plan.batches.map((x) => ({ tag: x.tag, kind: x.kind, carrier: x.carrier, count: x.orders.length, units: x.units, aisles: x.aisles })) });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}
