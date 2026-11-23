import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { previewWave, type Mode } from "@/lib/wave";
export const runtime = "nodejs"; export const maxDuration = 120;
// GET ?size=40&mode=all|singles|multis  – read-only look at the ShipStation queue
export async function GET(req: Request) {
  const user = await currentUser(); if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const u = new URL(req.url); const size = Math.min(300, Math.max(1, Number(u.searchParams.get("size") || 40))); const mode = (u.searchParams.get("mode") || "all") as Mode;
  try {
    const p = await previewWave(size, mode);
    return NextResponse.json({ queue: p.queue, singlesInQueue: p.singlesInQueue, count: p.orders.length, units: p.orders.reduce((a, o) => a + o.units, 0), skus: new Set(p.orders.flatMap((o) => o.items.map((i) => i.sku))).size, oldest: p.orders[0]?.created_at || null, sample: p.orders.slice(0, 8).map((o) => ({ number: o.shipment_number, name: o.ship_to_name, items: o.items.map((i) => i.name + " ×" + i.quantity) })) });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}
