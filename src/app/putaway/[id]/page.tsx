import { notFound } from "next/navigation";
import { getBatch, fmt } from "@/lib/putaway";
import ReceiveButton from "@/components/ReceiveButton";

export const dynamic = "force-dynamic";
export default async function BatchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ dup?: string }> }) {
  const { id } = await params; const sp = await searchParams;
  const got = await getBatch(Number(id)); if (!got) notFound();
  const { batch, lines } = got;
  const ok = lines.filter((l) => l.status === "ok"), noloc = lines.filter((l) => l.status === "noloc"), unk = lines.filter((l) => l.status === "unknown");
  const units = (xs: typeof lines) => xs.reduce((a, l) => a + l.qty, 0);
  const Block = ({ title, rows, cls }: { title: string; rows: typeof lines; cls?: string }) => rows.length ? (
    <>
      <div className="block-h">{title} – {rows.length} lines / {units(rows)} units</div>
      <table className="list"><thead><tr><th>Bin</th><th>Product</th><th>Size</th><th>Colour</th><th>SKU</th><th>Qty</th><th></th></tr></thead>
        <tbody>{rows.map((l, i) => (
          <tr key={l.barcode} className={(cls || "") + (i > 0 && rows[i - 1].bin !== l.bin && !cls ? " newbin" : "")}>
            <td className="bin">{l.bin}</td><td>{l.product || <em>barcode {l.barcode} not in Shopify</em>}</td><td>{l.size}</td><td>{l.colour}</td><td className="meta">{l.sku || l.barcode}</td><td className="qty">{l.qty}</td><td className="tick"><span /></td>
          </tr>))}</tbody></table>
    </>) : null;
  return (
    <>
      <div className="row noprint" style={{ justifyContent: "space-between" }}>
        <a href="/putaway" className="btn secondary">← New scan</a>
        <div className="row"><a href="#" className="btn secondary" onClick={undefined} data-print>Print</a></div>
      </div>
      <h1>Put-away #{batch.id} <span className={"pill " + batch.status}>{batch.status}</span></h1>
      <p className="sub">{fmt(batch.created_at)} · {batch.created_by} · {batch.lines} lines / {batch.units} units{batch.received_at ? ` · received ${fmt(batch.received_at)} by ${batch.received_by}` : ""}</p>
      {sp.dup && <div className="warn noprint">Heads up: an identical scan (batch #{sp.dup}) was already received in the last 48 hours. Receiving this one again will be refused unless you confirm it&apos;s a genuinely separate delivery.</div>}
      {batch.error && <div className="err noprint">Last attempt failed: {batch.error}</div>}
      <div className="noprint"><ReceiveButton id={batch.id} status={batch.status} units={units(ok) + units(noloc)} lines={ok.length + noloc.length} unknown={unk.length} /></div>
      <Block title="TO SHELVE (bin order)" rows={ok} />
      <Block title="NO LOCATION – give it a home, tell Sean" rows={noloc} cls="noloc" />
      <Block title="UNKNOWN BARCODE – check the label" rows={unk} cls="unknown" />
      <script dangerouslySetInnerHTML={{ __html: `document.querySelector('[data-print]').addEventListener('click',function(e){e.preventDefault();window.print();});` }} />
    </>
  );
}
