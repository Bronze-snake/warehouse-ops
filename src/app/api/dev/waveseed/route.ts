import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { getWave } from "@/lib/wave";
// Local testing only. Disabled in production.
export async function POST() {
  if (process.env.NODE_ENV === "production" || process.env.DEV_SEED !== "1") return NextResponse.json({ error: "disabled" }, { status: 404 });
  await getWave(0);
  const [run] = await q<{ id: number }>("INSERT INTO wave_runs(created_by, orders, units, lines, mode, preview) VALUES('Dev',4,6,4,'all',true) RETURNING id");
  const O = [["se-1", "#BS10021", "Jess Smith", 1, true, '[{"sku":"ARTY-NAV-S","name":"Arty Tee - S / Navy","quantity":1}]'], ["se-2", "#BS10022", "Tom Lee", 1, true, '[{"sku":"ARTY-NAV-S","name":"Arty Tee - S / Navy","quantity":1}]'], ["se-3", "#BS10023", "Amy Wu", 3, false, '[{"sku":"ECL-MARS-8","name":"Eclipse - 8 / Mars","quantity":1},{"sku":"PHIL-GRY-L","name":"Phillip - L / Grey","quantity":2}]'], ["se-4", "#BS10024", "Ben Kay", 1, true, '[{"sku":"LUNA-BLK-10","name":"Luna - 10 / Black","quantity":1}]']];
  for (const o of O) await q("INSERT INTO wave_orders(wave_id, shipment_id, number, name, items, single, items_json) VALUES($1,$2,$3,$4,$5,$6,$7)", [run.id, ...o]);
  const L = [["ARTY-NAV-S", "9340001", "Arty Cotton Hemp Tee Navy", "S", "Navy", "Singles", "A1R3", 2, 2], ["LUNA-BLK-10", "9340005", "Luna Linen Dress Black", "10", "Black", "Singles", "C2R1", 1, 1], ["ECL-MARS-8", "9340003", "Eclipse Swimsuit Mars", "8", "Mars", "Multis", "A1R11", 1, 1], ["PHIL-GRY-L", "9340004", "Phillip Washed Cotton Overshirt Grey", "L", "Grey", "Multis", "B4R2", 1, 2]];
  for (const l of L) await q("INSERT INTO wave_lines(run_id,sku,barcode,product,size,colour,dept,bin,sold,pick) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [run.id, ...l]);
  return NextResponse.json({ id: run.id });
}
