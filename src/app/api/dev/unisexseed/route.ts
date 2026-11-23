import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { getUnisexRun } from "@/lib/unisex";
export async function POST() {
  if (process.env.NODE_ENV === "production" || process.env.DEV_SEED !== "1") return NextResponse.json({ error: "disabled" }, { status: 404 });
  await getUnisexRun(0);
  const [run] = await q<{ id: number }>(`INSERT INTO unisex_runs(created_by, lines, units, pairs, notes_json) VALUES('Dev',3,4,55,'[{"product":"Roman Oversize Hoodie Black","size":"S","reason":"Unisex 1, Mens only 2 – under the floor of 3, left"}]') RETURNING id`);
  const L = [["v1","ii1","AP153-2 Grey-M","218481","A14R8","v2","ii2","AP153UNISEX-2 Grey-M","230031","B3R2","Unisex Roman Oversize Hoodie Grey","Roman Oversize Hoodie Grey","M","Mens → Unisex","M>U",74,0,2],
             ["v3","ii3","AP239-1-Black-S","224860","A2R1","v4","ii4","AP239UNISEX-1-Black-S","226605","B3R4","Unisex Vintage Bomber Denim Jacket Black","Vintage Bomber Denim Jacket Black","S","Mens → Unisex","M>U",9,1,1],
             ["v5","ii5","AP306UNISEX-4-Black-L","240001","B3R6","v6","ii6","AP306-2-Black-L","240002","A9R2","Roman Cropped Drop Hoodie Black","Unisex Roman Cropped Drop Hoodie Black","L","Unisex → Mens","U>M",5,0,1]];
  for (const l of L) await q("INSERT INTO unisex_lines(run_id,variant_id,from_inventory_item_id,sku,barcode,bin,to_variant_id,to_inventory_item_id,to_sku,to_barcode,to_bin,to_product,product,size,dept,direction,from_stock,to_stock,pick) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)", [run.id, ...l]);
  return NextResponse.json({ id: run.id });
}
