import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { receiveBatch } from "@/lib/putaway";
export const runtime = "nodejs";
export async function POST(req: Request) {
  const user = await currentUser(); if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id, force } = (await req.json()) as { id: number; force?: boolean };
  const r = await receiveBatch(Number(id), user, !!force);
  return NextResponse.json(r, { status: r.ok ? 200 : 409 });
}
