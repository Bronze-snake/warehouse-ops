"use client";
import { useEffect, useState } from "react";
type Run = { id: number; created_at: string; created_by: string; status: string; lines: number; units: number; pairs: number; picked: number; adjusted_at: string | null; adjusted_by: string | null };
const fmt = (ts: string) => new Date(ts).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function UnisexStart() {
  const [who, setWho] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [runs, setRuns] = useState<Run[]>([]);
  useEffect(() => { try { setWho(localStorage.getItem("ops-name") || localStorage.getItem("putaway-name") || ""); } catch {} fetch("/api/unisex/runs").then((r) => r.json()).then((j) => setRuns(j.runs || [])).catch(() => {}); }, []);
  async function run() {
    if (!who.trim()) { setErr("Put your name in first."); return; }
    try { localStorage.setItem("ops-name", who.trim()); } catch {}
    setBusy(true); setErr(null);
    try { const r = await fetch("/api/unisex/build", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ by: who.trim() }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error || "Failed"); window.location.href = `/unisex/${j.id}`; }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }
  const open = runs.filter((r) => r.status === "open"), done = runs.filter((r) => r.status !== "open");
  return (
    <>
      <h1>👕 Unisex</h1>
      <p className="sub">Balance the Unisex listings against their Mens twins at Preston. Rule: keep 2 of each size on Unisex from Mens, never take Mens below 3; send back to Mens only when Mens is at 0. FINAL SALE left alone.</p>
      <div className="card">
        <label>Your name</label>
        <input type="text" value={who} onChange={(e) => setWho(e.target.value)} placeholder="e.g. Kirsten" style={{ maxWidth: 260 }} />
        <div className="row" style={{ marginTop: 12 }}><button type="button" onClick={run} disabled={busy}>{busy ? "Checking every pair… (30–60 s)" : "RUN"}</button></div>
        {err && <div className="err">{err}</div>}
        <p className="meta" style={{ marginTop: 10 }}>RUN builds a pick list (scan the garment&apos;s current barcode, Skip if you don&apos;t want to move it). When you&apos;re done, <strong>ADJUST COUNTS</strong> moves the picked quantities in Shopify and the <strong>Labels CSV</strong> gives the printer the new barcodes.</p>
      </div>
      {open.length > 0 && <><h2>Open runs</h2><table className="list hist"><thead><tr><th>#</th><th>Started</th><th>By</th><th>Moves</th><th>Picked</th></tr></thead><tbody>
        {open.map((r) => <tr key={r.id}><td><a href={`/unisex/${r.id}`}>#{r.id}</a></td><td className="meta">{fmt(r.created_at)}</td><td>{r.created_by}</td><td>{r.lines} lines / {r.units} units</td><td>{r.picked}</td></tr>)}</tbody></table></>}
      {done.length > 0 && <><h2>Adjusted</h2><table className="list hist"><thead><tr><th>#</th><th>Adjusted</th><th>By</th><th>Moves</th></tr></thead><tbody>
        {done.slice(0, 15).map((r) => <tr key={r.id}><td><a href={`/unisex/${r.id}`}>#{r.id}</a></td><td className="meta">{r.adjusted_at ? fmt(r.adjusted_at) : ""}</td><td>{r.adjusted_by}</td><td>{r.picked} units</td></tr>)}</tbody></table></>}
    </>
  );
}
