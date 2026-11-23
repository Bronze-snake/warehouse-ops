import { currentUser } from "@/lib/auth";
import { getUnisexRun, labelsCsv } from "@/lib/unisex";
export const runtime = "nodejs";
// CSV for the label printer: Title, ALU (new barcode), Quantity
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser(); if (!user) return new Response("Not signed in", { status: 401 });
  const { id } = await ctx.params; const got = await getUnisexRun(Number(id)); if (!got) return new Response("Not found", { status: 404 });
  return new Response(labelsCsv(got.lines), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="unisex-labels-run${id}.csv"` } });
}
