import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { clearBatchTags } from "@/lib/batches";
export const runtime = "nodejs"; export const maxDuration = 300;
// POST – removes BATCH-* tags from orders still awaiting shipment so the queue can be re-planned
export async function POST() {
  const user = await currentUser(); if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (process.env.SHIPSTATION_TAGGING !== "1") return NextResponse.json({ error: "Tagging is switched off on this server (SHIPSTATION_TAGGING)" }, { status: 403 });
  try { return NextResponse.json(await clearBatchTags()); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}
