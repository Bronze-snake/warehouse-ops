"use client";
import { useEffect, useState } from "react";
import BatchPlanner from "./BatchPlanner";

type Run = { id: number; created_at: string; created_by: string; status: string; orders: number; units: number; lines: number; mode: string; preview: boolean; tag: string | null; tag_error: string | null; picked: number; finished_at: string | null };
type Preview = { queue: number; singlesInQueue: number; count: number; units: number; skus: number; oldest: string | null; sample: { number: string; name: string; items: string[] }[] };
const fmt = (ts: string) => new Date(ts).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function WaveStart() {
  const [size, setSize] = useState(40);
  const [mode, setMode] = useState<"all" | "singles" | "multis">("all");
  const [prev, setPrev] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"" | "preview" | "build">("");
  const [err, setErr] = useState<string | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [tagging, setTagging] = useState(false);
  const [configured, setConfigured] = useState(true);
  useEffect(() => { fetch("/api/wave/runs").then((r) => r.json()).then((j) => { setRuns(j.runs || []); setTagging(!!j.taggingEnabled); setConfigured(j.configured !== false); }).catch(() => {}); }, []);

  async function preview() {
    setBusy("preview"); setErr(null); setPrev(null);
    try { const r = await fetch(`/api/wave/preview?size=${size}&mode=${mode}`); const j = await r.json(); if (!r.ok) throw new Error(j.error || "Failed"); setPrev(j); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy("");
  }
  async function build(previewOnly: boolean) {
    if (!previewOnly && !confirm(`Start a real wave of ${size} orders? They will be tagged WAVE-<n> in ShipStation so nobody picks them twice. Nothing else changes in ShipStation.`)) return;
    setBusy("build"); setErr(null);
    try {
      const r = await fetch("/api/wave/build", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ size, mode, preview: previewOnly }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || "Failed");
      window.location.href = `/orders/${j.id}`;
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(""); }
  }
  const open = runs.filter((r) => r.status === "open");

  return (
    <>
      <h1>📬 Orders</h1>
      <p className="sub">Plan the morning in ShipStation-friendly batches, or run a scan-to-confirm wave. Labels and Scan &amp; Verify stay in ShipStation.</p>
      {!configured && <div className="err">ShipStation isn&apos;t connected on this server yet – add SHIPSTATION_API_KEY in Vercel and redeploy.</div>}
      <BatchPlanner configured={configured} />
      <h2>Wave pick (scan as you go)</h2>
      <p className="meta" style={{ marginTop: -4 }}>Experimental: the oldest orders merged into one list by SKU in bin order, scanned on the phone.</p>
      <div className="card">
        <label>Orders in this wave</label>
        <div className="row">{[20, 40, 60, 100].map((n) => <button key={n} type="button" className={size === n ? "" : "secondary"} onClick={() => setSize(n)}>{n}</button>)}
          <input type="number" min={1} max={300} value={size} onChange={(e) => setSize(Number(e.target.value) || 1)} style={{ width: 80, padding: 8, font: "inherit", border: "1px solid #ddd", borderRadius: 8 }} /></div>
        <label>Which orders</label>
        <div className="segs">{(["all", "singles", "multis"] as const).map((m) => <button key={m} type="button" className={mode === m ? "on" : ""} onClick={() => setMode(m)}>{m === "all" ? "Singles + multis" : m === "singles" ? "Singles only" : "Multis only"}</button>)}</div>
        <div className="row" style={{ marginTop: 14 }}>
          <button type="button" className="secondary" onClick={preview} disabled={!!busy || !configured}>{busy === "preview" ? "Looking…" : "Preview queue"}</button>
          <button type="button" className="secondary" onClick={() => build(true)} disabled={!!busy || !configured}>{busy === "build" ? "Building…" : "Build preview wave"}</button>
          {tagging && <button type="button" onClick={() => build(false)} disabled={!!busy || !configured}>Start wave (tags ShipStation)</button>}
        </div>
        {!tagging && <p className="meta" style={{ marginTop: 8 }}>Preview mode: waves are built from the live queue but ShipStation is never written to. Once you&apos;re happy, set SHIPSTATION_TAGGING=1 in Vercel to turn on tagging.</p>}
        {err && <div className="err">{err}</div>}
        {prev && (
          <div className="ok" style={{ marginTop: 10 }}>
            <strong>{prev.count} orders · {prev.units} units · {prev.skus} SKUs</strong> would go in this wave.<br />
            <span className="meta">Queue right now: {prev.queue} orders awaiting shipment ({prev.singlesInQueue} singles). Oldest in wave: {prev.oldest ? fmt(prev.oldest) : "–"}.</span>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 14 }}>{prev.sample.map((s) => <li key={s.number}><strong>{s.number}</strong> {s.name} — {s.items.join(", ")}</li>)}</ul>
          </div>
        )}
      </div>
      {open.length > 0 && <>
        <h2>Open waves</h2>
        <table className="list hist"><thead><tr><th>#</th><th>Orders</th><th>Progress</th><th>Started</th></tr></thead><tbody>
          {open.map((r) => <tr key={r.id}><td><a href={`/orders/${r.id}`}>Wave {r.id}</a>{r.preview && <span className="pill" style={{ marginLeft: 6 }}>preview</span>}{r.tag_error && <span className="pill error" style={{ marginLeft: 6 }}>tag problem</span>}</td><td>{r.orders} ({r.mode})</td><td>{r.picked} / {r.units} units</td><td className="meta">{fmt(r.created_at)}</td></tr>)}
        </tbody></table>
      </>}
      {runs.some((r) => r.status === "finished") && <>
        <h2>Finished</h2>
        <table className="list hist"><thead><tr><th>#</th><th>Orders</th><th>Units</th><th>Finished</th></tr></thead><tbody>
          {runs.filter((r) => r.status === "finished").slice(0, 15).map((r) => <tr key={r.id}><td><a href={`/orders/${r.id}`}>Wave {r.id}</a></td><td>{r.orders}</td><td>{r.picked} / {r.units}</td><td className="meta">{r.finished_at ? fmt(r.finished_at) : ""}</td></tr>)}
        </tbody></table>
      </>}
    </>
  );
}
