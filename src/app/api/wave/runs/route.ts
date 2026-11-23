import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { listWaves } from "@/lib/wave";
export const runtime = "nodejs";
export async function GET() {
  const user = await currentUser(); if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json({ runs: await listWaves(), taggingEnabled: process.env.SHIPSTATION_TAGGING === "1", configured: !!process.env.SHIPSTATION_API_KEY });
}
