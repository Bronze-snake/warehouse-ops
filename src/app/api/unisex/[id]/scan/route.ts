import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { scanUnisex } from "@/lib/unisex";
export const runtime = "nodejs";
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser(); if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params; const b = (await req.json()) as { barcode: string; dept?: string | null; by?: string };
  if (!b.barcode?.trim()) return NextResponse.json({ ok: false, message: "No barcode" }, { status: 400 });
  return NextResponse.json(await scanUnisex(Number(id), b.barcode, String(b.by || "").trim().slice(0, 40) || user, b.dept || null));
}
