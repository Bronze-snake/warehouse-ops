import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { overrideUnisex } from "@/lib/unisex";
export const runtime = "nodejs";
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser(); if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params; const b = (await req.json()) as { line: number; action: "pick" | "undo" | "skip"; by?: string };
  const line = await overrideUnisex(Number(id), Number(b.line), b.action === "undo" ? "undo" : b.action === "skip" ? "skip" : "pick", String(b.by || "").trim().slice(0, 40) || user);
  if (!line) return NextResponse.json({ error: "Line not found" }, { status: 404 });
  return NextResponse.json({ line });
}
