import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { receiveBatch } from "@/lib/putaway";
export const runtime = "nodejs";
export async function POST(req: Request) {
  const user = await currentUser(); if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id, force, by } = (await req.json()) as { id: number; force?: boolean; by?: string };
  const r = await receiveBatch(Number(id), String(by || "").trim().slice(0, 40) || user, !!force);
  return NextResponse.json(r, { status: r.ok ? 200 : 409 });
}
