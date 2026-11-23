import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { buildBatch, parseScan } from "@/lib/putaway";
export const runtime = "nodejs";
export async function POST(req: Request) {
  const user = await currentUser(); if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  try {
    const form = await req.formData();
    let text = String(form.get("text") || "");
    const file = form.get("file"); if (file && typeof file !== "string" && file.size) text += "\n" + (await file.text());
    const scan = parseScan(text);
    if (!Object.keys(scan).length) return NextResponse.json({ error: "No barcodes found. Expected two columns: Barcode, Quantity." }, { status: 400 });
    const by = String(form.get("by") || "").trim().slice(0, 40) || user;
    const r = await buildBatch(scan, by);
    return NextResponse.json({ id: r.batch.id, duplicateOf: r.duplicateOf });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}
