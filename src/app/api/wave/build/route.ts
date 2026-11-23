import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { createWave, type Mode } from "@/lib/wave";
export const runtime = "nodejs"; export const maxDuration = 300;
// POST { size, mode, preview }   preview=true never writes to ShipStation
export async function POST(req: Request) {
  const user = await currentUser(); if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const b = (await req.json()) as { size?: number; mode?: Mode; preview?: boolean };
  const allowTag = process.env.SHIPSTATION_TAGGING === "1";
  try {
    const run = await createWave(Math.min(300, Math.max(1, Number(b.size || 40))), b.mode || "all", user, b.preview !== false || !allowTag);
    return NextResponse.json({ id: run.id, run, taggingEnabled: allowTag });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}
