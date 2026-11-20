import { currentUser } from "@/lib/auth";
import { getRun, manifestCsv } from "@/lib/picklist";
export const runtime = "nodejs";
// GET -> CSV of what was picked (transfer manifest)
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser(); if (!user) return new Response("Not signed in", { status: 401 });
  const { id } = await ctx.params;
  const got = await getRun(Number(id)); if (!got) return new Response("Not found", { status: 404 });
  const name = `${got.run.store}-${got.run.label.replace(/[^A-Za-z0-9]+/g, "_")}-pick${got.run.id}.csv`;
  return new Response(manifestCsv(got.lines), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"` } });
}
