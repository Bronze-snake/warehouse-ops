import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { resolveBarcodes, shopifyConfigured, gql } from "@/lib/shopify";
export const runtime = "nodejs";

type Hit = { sku: string; bin: string; name: string; size?: string; colour?: string; via: string };

// GET /api/find?q=...  – a barcode (digits), a SKU, or words from a product name. Returns bins.
export async function GET(req: Request) {
  const user = await currentUser(); if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const term = (new URL(req.url).searchParams.get("q") || "").trim();
  if (!term) return NextResponse.json({ hits: [] });
  const hits: Hit[] = [];

  // 1. barcode (all digits, or anything we've cached)
  if (/^\d{4,}$/.test(term)) {
    const info = await resolveBarcodes([term]);
    const v = info[term];
    if (v) {
      const b = await q<{ bin: string; name: string }>("SELECT bin, name FROM bins WHERE sku=$1", [v.sku]);
      hits.push({ sku: v.sku, bin: b[0]?.bin || "", name: v.product, size: v.size, colour: v.colour, via: "barcode" });
      // same style, other sizes – from the location master by SKU prefix (SKU minus the trailing size token)
      const prefix = v.sku.replace(/-[^-]+$/, "");
      if (prefix && prefix !== v.sku) {
        const sib = await q<{ sku: string; bin: string; name: string }>("SELECT sku, bin, name FROM bins WHERE sku LIKE $1 AND sku<>$2 ORDER BY sku LIMIT 30", [prefix + "-%", v.sku]);
        for (const s of sib) hits.push({ sku: s.sku, bin: s.bin, name: s.name || v.product, size: s.sku.slice(prefix.length + 1), via: "style" });
      }
      return NextResponse.json({ hits, mode: "barcode" });
    }
  }

  // 2. exact / prefix SKU
  const bySku = await q<{ sku: string; bin: string; name: string }>("SELECT sku, bin, name FROM bins WHERE sku ILIKE $1 ORDER BY sku LIMIT 40", [term + "%"]);
  for (const s of bySku) hits.push({ sku: s.sku, bin: s.bin, name: s.name, via: "sku" });

  // 3. product name words (all words must appear) in the location master
  const words = term.split(/\s+/).filter(Boolean);
  if (words.length) {
    const conds = words.map((_, i) => `name ILIKE $${i + 1}`).join(" AND ");
    const byName = await q<{ sku: string; bin: string; name: string }>(`SELECT sku, bin, name FROM bins WHERE ${conds} ORDER BY name, sku LIMIT 80`, words.map((w) => "%" + w + "%"));
    for (const s of byName) if (!hits.some((h) => h.sku === s.sku)) hits.push({ sku: s.sku, bin: s.bin, name: s.name, via: "name" });
  }

  // 4. nothing local – ask Shopify for the style and map its SKUs to bins
  if (!hits.length && shopifyConfigured() && words.length) {
    type R = { products: { nodes: { title: string; variants: { nodes: { sku: string | null; title: string }[] } }[] } };
    const d = await gql<R>(`query($q:String!){ products(first:8, query:$q){ nodes{ title variants(first:40){ nodes{ sku title } } } } }`, { q: words.map((w) => `title:*${w.replace(/[^A-Za-z0-9]/g, "")}*`).join(" AND ") });
    const skus = d.products.nodes.flatMap((p) => p.variants.nodes.map((v) => v.sku || "")).filter(Boolean);
    const bins = skus.length ? await q<{ sku: string; bin: string }>("SELECT sku, bin FROM bins WHERE sku = ANY($1)", [skus]) : [];
    const bmap: Record<string, string> = {}; for (const b of bins) bmap[b.sku] = b.bin;
    for (const p of d.products.nodes) for (const v of p.variants.nodes) if (v.sku) hits.push({ sku: v.sku, bin: bmap[v.sku] || "", name: p.title.replace(/ - FINAL SALE$/i, ""), size: v.title === "Default Title" ? "" : v.title, via: "shopify" });
  }
  return NextResponse.json({ hits, mode: "search" });
}
