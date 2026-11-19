import { listBatches, fmt } from "@/lib/putaway";
export const dynamic = "force-dynamic";
export default async function History() {
  const rows = await listBatches(100);
  return (
    <>
      <h1>Put-away history</h1>
      <p className="sub">Last 100 batches. Open one to reprint or receive.</p>
      <table className="list hist"><thead><tr><th>#</th><th>Built</th><th>By</th><th>Lines</th><th>Units</th><th>Status</th><th>Received</th></tr></thead>
        <tbody>{rows.map((b) => (<tr key={b.id}><td><a href={`/putaway/${b.id}`}>#{b.id}</a></td><td>{fmt(b.created_at)}</td><td>{b.created_by}</td><td>{b.lines}</td><td>{b.units}</td><td><span className={"pill " + b.status}>{b.status}</span></td><td>{b.received_at ? `${fmt(b.received_at)} · ${b.received_by}` : ""}</td></tr>))}</tbody></table>
      <p><a className="btn secondary" href="/">Back</a></p>
    </>
  );
}
