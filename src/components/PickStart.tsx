"use client";
import { useEffect, useState } from "react";

const STORES = [{ key: "f", name: "Fitzroy" }, { key: "p", name: "Prahran" }, { key: "g", name: "Glenelg" }, { key: "n", name: "Newtown" }];
type Run = { id: number; store: string; label: string; created_at: string; created_by: string; status: string; lines: number; units: number; picked: number; finished_at: string | null };

// Default sales window: Monday → Fri–Sun, otherwise yesterday (phone is on Melbourne time).
function defaults() {
  const t = new Date(); const dow = t.getDay(); // 1 = Mon
  const back = dow === 1 ? 3 : 1;
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const from = new Date(t); from.setDate(t.getDate() - back); const to = new Date(t); to.setDate(t.getDate() - 1);
  return { from: iso(from), to: iso(to) };
}
const fmt = (ts: string) => new Date(ts).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function PickStart() {
  const d = defaults();
  const [store, setStore] = useState("");
  const [from, setFrom] = useState(d.from);
  const [to, setTo] = useState(d.to);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  useEffect(() => { fetch("/api/pick/runs").then((r) => r.json()).then((j) => setRuns(j.runs || [])).catch(() => {}); }, []);

  async function build(force = false) {
    if (!store) { setErr("Pick a store first"); return; }
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/pick/build", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ store, from, to, force }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || "Failed");
      window.location.href = `/pick/${j.id}` + (j.existing ? "?existing=1" : "");
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }
  const open = runs.filter((r) => r.status === "open"), done = runs.filter((r) => r.status === "finished");

  return (
    <>
      <h1>Pick list</h1>
      <p className="sub">Store replen – same rules as the Replen sheet. Pick a store, check the sales dates, Build.</p>
      <div className="card">
        <label>Store</label>
        <div className="row">{STORES.map((s) => <button key={s.key} type="button" className={store === s.key ? "" : "secondary"} onClick={() => setStore(s.key)} style={{ flex: "1 1 120px", fontSize: 17 }}>{s.name}</button>)}</div>
        <div className="row" style={{ marginTop: 8 }}>
          <div style={{ flex: 1 }}><label>Sales from</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: "100%", padding: 10, font: "inherit" }} /></div>
          <div style={{ flex: 1 }}><label>to (inclusive)</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: "100%", padding: 10, font: "inherit" }} /></div>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <button type="button" onClick={() => build(false)} disabled={busy || !store} style={{ flex: 1, fontSize: 18 }}>{busy ? "Building… (20–60 s)" : "Build pick list"}</button>
        </div>
        {err && <div className="err">{err}</div>}
        <p className="meta" style={{ marginTop: 10 }}>If a list for that store and dates is already open, you&apos;ll be taken to it (so two phones share one list). Use “Rebuild” inside the list to refresh it.</p>
      </div>

      {open.length > 0 && <>
        <h2>Open pick lists</h2>
        <table className="list hist"><thead><tr><th>#</th><th>Store</th><th>Sales</th><th>Progress</th><th>Started</th></tr></thead><tbody>
          {open.map((r) => <tr key={r.id}><td><a href={`/pick/${r.id}`}>#{r.id}</a></td><td><a href={`/pick/${r.id}`}>{r.store}</a></td><td>{r.label}</td><td>{r.picked} / {r.units} units</td><td className="meta">{fmt(r.created_at)}</td></tr>)}
        </tbody></table>
      </>}
      {done.length > 0 && <>
        <h2>Finished</h2>
        <table className="list hist"><thead><tr><th>#</th><th>Store</th><th>Sales</th><th>Sent</th><th>Finished</th></tr></thead><tbody>
          {done.slice(0, 15).map((r) => <tr key={r.id}><td><a href={`/pick/${r.id}`}>#{r.id}</a></td><td>{r.store}</td><td>{r.label}</td><td>{r.picked} / {r.units} units</td><td className="meta">{r.finished_at ? fmt(r.finished_at) : ""}</td></tr>)}
        </tbody></table>
      </>}
    </>
  );
}
