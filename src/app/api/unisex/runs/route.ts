import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { listUnisexRuns } from "@/lib/unisex";
export const runtime = "nodejs";
export async function GET() {
  const user = await currentUser(); if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json({ runs: await listUnisexRuns() });
}
