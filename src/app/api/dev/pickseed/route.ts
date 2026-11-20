import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { getRun } from "@/lib/picklist";
// Local testing only: creates a pick run with sample lines (no Shopify). Disabled in production.
export async function POST() {
  if (process.env.NODE_ENV === "production" || process.env.DEV_SEED !== "1") return NextResponse.json({ error: "disabled" }, { status: 404 });
  await getRun(0); // ensures schema
  const [run] = await q<{ id: number }>(`INSERT INTO pick_runs(store_key, store, "start", "end", label, created_by, lines, units) VALUES('f','Fitzroy',now()-interval '1 day',now(),'Wed 19 Nov','Dev',5,7) RETURNING id`);
  const L = [
    ["v1", "ARTY-NAV-S", "9340001", "Arty Cotton Hemp Tee Navy", "S", "Navy", "Mens", "A1R3", 1, 0, 12, 2],
    ["v2", "ARTY-NAV-M", "9340002", "Arty Cotton Hemp Tee Navy", "M", "Navy", "Mens", "A1R3", 1, 1, 8, 1],
    ["v3", "ECL-MARS-8", "9340003", "Eclipse Swimsuit Mars", "8", "Mars", "Womens", "A1R11", 1, 0, 6, 1],
    ["v4", "PHIL-GRY-L", "9340004", "Phillip Washed Cotton Overshirt Grey", "L", "Grey", "Mens", "B4R2", 2, 0, 5, 2],
    ["v5", "LUNA-BLK-10", "9340005", "Luna Linen Dress Black", "10", "Black", "Womens", "", 1, 0, 9, 1],
  ];
  for (const l of L) await q("INSERT INTO pick_lines(run_id,variant_id,sku,barcode,product,size,colour,dept,bin,sold,store_stock,wh_stock,pick) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)", [run.id, ...l]);
  return NextResponse.json({ id: run.id });
}
