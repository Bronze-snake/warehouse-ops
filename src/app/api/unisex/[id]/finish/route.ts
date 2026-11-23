import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { adjustUnisexRun } from "@/lib/unisex";
export const runtime = "nodejs"; export const maxDuration = 60;
// "ADJUST COUNTS" – the paired Shopify adjustment for everything picked on this run
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser(); if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params; const b = (await req.json().catch(() => ({}))) as { by?: string };
  const r = await adjustUnisexRun(Number(id), String(b.by || "").trim().slice(0, 40) || user);
  return NextResponse.json(r, { status: r.ok ? 200 : 409 });
}
