import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getRun } from "@/lib/picklist";
export const runtime = "nodejs";
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser(); if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  const got = await getRun(Number(id)); if (!got) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(got);
}
