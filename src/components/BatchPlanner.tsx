"use client";
import { useEffect, useState } from "react";

type B = { tag: string; kind: string; carrier: string; count: number; units: number; skus: number; aisles: string; sample: string[] };
type Plan = { batches: B[]; queue: number; singles: number; multis: number; big: number; untagged: number; alreadyTagged: number; noBin: number; skipped: Record<string, number>; plannedAt: string };
type Run = { id: number; created_at: string; created_by: string; batches: number; orders: number; tagged: number; failed: number; summary: string };
const fmt = (ts: string) => new Date(ts).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function BatchPlanner({ configured }: { configured: boolean }) {
  const [singles, setSingles] = useState(40);
  const [multis, setMultis] = useState(20);
  const [express, setExpress] = useState(true);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [tagging, setTagging] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function load() {
    setBusy("plan"); setErr(null); setDone(null);
    try { const r = await fetch(`/api/batches/plan?singles=${singles}&multis=${multis}&express=${express ? 1 : 0}`); const j = await r.json(); if (!r.ok) throw new Error(j.error || "Failed"); setPlan(j.plan); setRuns(j.runs || []); setTagging(!!j.taggingEnabled); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy("");
  }
  useEffect(() => { if (configured) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [configured]);

  const [progress, setProgress] = useState<{ done: number; failed: number; total: number } | null>(null);
  // Tagging is paced (ShipStation allows ~40 calls a minute), so the server works in ~45 s slices and we keep asking for the next one.
  async function runJob(url: string, startBody: Record<string, unknown>, doneText: (j: { done: number; failed: number; total: number; batches?: number }) => string) {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phase: "start", ...startBody }) });
    const j0 = await r.json(); if (!r.ok) throw new Error(j0.error || "Failed");
    let job = j0.job as { done: number; failed: number; total: number; batches?: number };
    setProgress(job);
    while (job && job.done + job.failed < job.total) {
      const s = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phase: "step" }) });
      const js = await s.json(); if (!s.ok) throw new Error(js.error || "Failed mid-way – press again to continue");
      job = js.job; setProgress(job);
    }
    setProgress(null); setDone(doneText(job));
  }
  async function apply() {
    if (!plan || !confirm(`Tag ${plan.untagged} orders into ${plan.batches.length} batches (BATCH-01 … BATCH-${String(plan.batches.length).padStart(2, "0")}) in ShipStation? Tags only – nothing else changes. Takes about ${Math.ceil(plan.untagged * 1.6 / 60)} min – keep this page open.`)) return;
    setBusy("apply"); setErr(null); setDone(null);
    try { await runJob("/api/batches/apply", { singles, multis, express }, (j) => `Tagged ${j.done} orders into ${j.batches} batches${j.failed ? ` (${j.failed} failed – they stay untagged)` : ""}. In ShipStation: Awaiting Shipment → filter by tag → print.`); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(""); setProgress(null);
  }
  async function clear() {
    if (!confirm("Remove BATCH tags from every order still awaiting shipment, so you can re-plan? Already-shipped orders are untouched.")) return;
    setBusy("clear"); setErr(null); setDone(null);
    try { await runJob("/api/batches/clear", {}, (j) => `Cleared tags from ${j.done} orders.`); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(""); setProgress(null);
  }

  return (
    <div className="card">
      <h2 style={{ margin: "0 0 4px" }}>Morning print batches</h2>
      <p className="meta" style={{ margin: "0 0 10px" }}>Splits the whole queue into short walks and tags each order BATCH-01, 02… One carrier per batch (Australia Post and DHL never mix). Store, Split, 5411, Same Day and Local Pickup orders are left alone; “More Than 6” orders get their own batches. Singles are sorted by bin then SKU (identical items together); multis are grouped by aisle. Print each tag in ShipStation and pick as you do today.</p>
      <div className="row">
        <label style={{ margin: 0 }}>Singles per batch <input type="number" min={5} max={200} value={singles} onChange={(e) => setSingles(Number(e.target.value) || 40)} style={{ width: 70, padding: 6, font: "inherit", border: "1px solid #ddd", borderRadius: 8, marginLeft: 6 }} /></label>
        <label style={{ margin: 0 }}>Multis per batch <input type="number" min={3} max={100} value={multis} onChange={(e) => setMultis(Number(e.target.value) || 20)} style={{ width: 70, padding: 6, font: "inherit", border: "1px solid #ddd", borderRadius: 8, marginLeft: 6 }} /></label>
        <label style={{ margin: 0 }}><input type="checkbox" checked={express} onChange={(e) => setExpress(e.target.checked)} /> Express first</label>
        <button type="button" className="secondary" onClick={load} disabled={!!busy || !configured}>{busy === "plan" ? "Planning…" : "Re-plan"}</button>
      </div>
      {err && <div className="err">{err}</div>}
      {done && <div className="ok">{done}</div>}
      {progress && <div className="warn">{busy === "clear" ? "Clearing" : "Tagging"} in ShipStation… {progress.done + progress.failed} / {progress.total}{progress.failed ? ` (${progress.failed} failed)` : ""} — keep this page open.</div>}
      {plan && (
        <>
          <p className="meta" style={{ margin: "12px 0 6px" }}>
            Queue: <strong>{plan.queue}</strong> awaiting shipment · {plan.singles} singles + {plan.multis} multis{plan.big ? ` + ${plan.big} big orders` : ""} to batch{plan.alreadyTagged ? ` · ${plan.alreadyTagged} already tagged` : ""}{plan.noBin ? ` · ${plan.noBin} orders have an item with no bin (they go last in their batch)` : ""}
            {Object.keys(plan.skipped || {}).length > 0 && <><br />Left alone: {Object.entries(plan.skipped).map(([k, v]) => `${k} ${v}`).join(" · ")}</>}
          </p>
          {plan.batches.length === 0 ? <div className="ok">Nothing left to batch.</div> : (
            <table className="list"><thead><tr><th>Tag</th><th>Carrier</th><th>Type</th><th>Orders</th><th>Units</th><th>SKUs</th><th>Aisles</th></tr></thead><tbody>
              {plan.batches.map((b) => <tr key={b.tag}><td><strong>{b.tag}</strong></td><td>{b.carrier}</td><td>{b.kind}</td><td>{b.count}</td><td>{b.units}</td><td>{b.skus}</td><td className="meta">{b.aisles || "–"}</td></tr>)}
            </tbody></table>
          )}
          <div className="row" style={{ marginTop: 12 }}>
            {tagging ? <>
              <button type="button" onClick={apply} disabled={!!busy || !plan.batches.length}>{busy === "apply" ? "Tagging…" : `Tag ${plan.batches.length} batches in ShipStation`}</button>
              <button type="button" className="secondary" onClick={clear} disabled={!!busy}>{busy === "clear" ? "Clearing…" : "Clear BATCH tags (re-plan)"}</button>
            </> : <span className="meta">Preview only – set SHIPSTATION_TAGGING=1 in Vercel to enable tagging.</span>}
          </div>
        </>
      )}
      {runs.length > 0 && (
        <details style={{ marginTop: 12 }}><summary className="meta" style={{ cursor: "pointer" }}>Previous batch runs</summary>
          {runs.map((r) => <div key={r.id} style={{ marginTop: 8, fontSize: 14 }}><strong>{fmt(r.created_at)}</strong> · {r.created_by} · {r.batches} batches / {r.orders} orders{r.failed ? ` · ${r.failed} failed` : ""}<pre style={{ whiteSpace: "pre-wrap", margin: "4px 0 0", color: "#555", fontSize: 13 }}>{r.summary}</pre></div>)}
        </details>
      )}
    </div>
  );
}
