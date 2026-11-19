import { NextResponse } from "next/server";
import { q } from "@/lib/db";
// Local testing only: seeds the barcode cache so lists can be built without Shopify credentials. Disabled in production.
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production" || process.env.DEV_SEED !== "1") return NextResponse.json({ error: "disabled" }, { status: 404 });
  const rows = (await req.json()) as { barcode: string; variant_id: string; inventory_item_id: string; sku: string; product: string; size: string; colour: string }[];
  for (const r of rows) await q("INSERT INTO variants(barcode,variant_id,inventory_item_id,sku,product,size,colour) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(barcode) DO NOTHING", [r.barcode, r.variant_id, r.inventory_item_id, r.sku, r.product, r.size, r.colour]);
  return NextResponse.json({ ok: rows.length });
}
