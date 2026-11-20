import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { scanLine } from "@/lib/picklist";
export const runtime = "nodejs";
// POST { barcode, dept?: "Womens"|"Mens" }
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser(); if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  const b = (await req.json()) as { barcode: string; dept?: string | null };
  if (!b.barcode?.trim()) return NextResponse.json({ ok: false, message: "No barcode" }, { status: 400 });
  return NextResponse.json(await scanLine(Number(id), b.barcode, user, b.dept || null));
}
