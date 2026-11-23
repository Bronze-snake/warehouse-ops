import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { planBatches, startTagJob, stepJob } from "@/lib/batches";
export const runtime = "nodejs"; export const maxDuration = 60;
// POST { phase: "start", singles, multis, express } -> plans + queues the tag job (no writes yet)
// POST { phase: "step" } -> performs ~45 s of paced tag writes, returns progress; browser repeats until done+failed == total
export async function POST(req: Request) {
  const user = await currentUser(); if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (process.env.SHIPSTATION_TAGGING !== "1") return NextResponse.json({ error: "Tagging is switched off on this server (SHIPSTATION_TAGGING)" }, { status: 403 });
  const b = (await req.json()) as { phase?: string; singles?: number; multis?: number; express?: boolean };
  try {
    if (b.phase === "step") { const j = await stepJob(45000); return NextResponse.json({ job: j }); }
    const plan = await planBatches(Number(b.singles || 40), Number(b.multis || 20), b.express !== false);
    if (!plan.batches.length) return NextResponse.json({ error: "Nothing to batch – every order awaiting shipment already has a BATCH tag" }, { status: 409 });
    const job = await startTagJob(plan, user);
    if (job.missingTags?.length) return NextResponse.json({ error: `These tags don't exist in ShipStation yet – create them (Orders → Tag ▾ → Manage tags) then try again: ${job.missingTags.join(", ")}` }, { status: 409 });
    return NextResponse.json({ job, batchesList: plan.batches.map((x) => ({ tag: x.tag, kind: x.kind, carrier: x.carrier, count: x.orders.length, units: x.units, aisles: x.aisles })) });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}
