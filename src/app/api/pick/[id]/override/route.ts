import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { overrideLine } from "@/lib/picklist";
export const runtime = "nodejs";
// POST { line: number, action: "pick"|"undo" }
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser(); if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  const b = (await req.json()) as { line: number; action: "pick" | "undo" | "skip" };
  const line = await overrideLine(Number(id), Number(b.line), b.action === "undo" ? "undo" : b.action === "skip" ? "skip" : "pick", user);
  if (!line) return NextResponse.json({ error: "Line not found" }, { status: 404 });
  return NextResponse.json({ line });
}
