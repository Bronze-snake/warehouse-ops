import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { createUnisexRun } from "@/lib/unisex";
export const runtime = "nodejs"; export const maxDuration = 300;
export async function POST(req: Request) {
  const user = await currentUser(); if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { by?: string };
  try { const run = await createUnisexRun(String(b.by || "").trim().slice(0, 40) || user); return NextResponse.json({ id: run.id, run }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}
