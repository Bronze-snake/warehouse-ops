import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { finishWave } from "@/lib/wave";
export const runtime = "nodejs";
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser(); if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params; const r = await finishWave(Number(id), user);
  return NextResponse.json(r, { status: r.ok ? 200 : 409 });
}
