import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { overrideWave } from "@/lib/wave";
export const runtime = "nodejs";
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser(); if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params; const b = (await req.json()) as { line: number; action: "pick" | "undo" };
  const line = await overrideWave(Number(id), Number(b.line), b.action === "undo" ? "undo" : "pick", user);
  if (!line) return NextResponse.json({ error: "Line not found" }, { status: 404 });
  return NextResponse.json({ line });
}
