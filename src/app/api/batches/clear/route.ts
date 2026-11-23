import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { startClearJob, stepJob } from "@/lib/batches";
export const runtime = "nodejs"; export const maxDuration = 60;
// POST { phase: "start" } queues removal of BATCH-* tags from orders still awaiting shipment; { phase: "step" } works through it
export async function POST(req: Request) {
  const user = await currentUser(); if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (process.env.SHIPSTATION_TAGGING !== "1") return NextResponse.json({ error: "Tagging is switched off on this server (SHIPSTATION_TAGGING)" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { phase?: string };
  try {
    if (b.phase === "step") return NextResponse.json({ job: await stepJob(45000) });
    return NextResponse.json({ job: await startClearJob(user) });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}
