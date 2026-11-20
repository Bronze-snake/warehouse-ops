"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import CameraScan, { beep, buzz, type Recent } from "./CameraScan";

type Line = { id: number; sku: string; barcode: string; product: string; size: string; colour: string; dept: string; bin: string; sold: number; store_stock: number; wh_stock: number; pick: number; picked: number; picked_by: string | null; method: string | null };
type Run = { id: number; store: string; label: string; status: string; created_at: string; created_by: string; finished_at: string | null; finished_by: string | null; lines: number; units: number; removed: number };
type Removed = { product: string; size: string; colour: string; sku: string; sold: number; reason: string };
type Data = { run: Run; lines: Line[]; removed: Removed[] };
type Dept = "" | "Womens" | "Mens";

const label = (l: Line) => `${l.product} · ${l.size}${l.colour && !l.product.toLowerCase().includes(l.colour.toLowerCase()) ? " · " + l.colour : ""}`;

export default function PickView({ id, existing }: { id: number; existing?: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dept, setDept] = useState<Dept>("");
  const [hideDone, setHideDone] = useState(true);
  const [cam, setCam] = useState(false);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [openLine, setOpenLine] = useState<number | null>(null);
  const [gun, setGun] = useState("");
  const [busy, setBusy] = useState(false);
  const gunRef = useRef<HTMLInputElement>(null);
  const deptKey = `pick-dept:${id}`;

  const load = useCallback(async () => {
    try { const r = await fetch(`/api/pick/${id}`, { cache: "no-store" }); const j = await r.json(); if (!r.ok) throw new Error(j.error || "Failed"); setData(j); setErr(null); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [id]);
  useEffect(() => { load(); try { setDept((localStorage.getItem(deptKey) as Dept) || ""); } catch {} }, [load, deptKey]);
  useEffect(() => { if (!data || data.run.status !== "open" || cam) return; const t = setInterval(load, 15000); return () => clearInterval(t); }, [data, cam, load]);
  function pickDept(d: Dept) { setDept(d); try { localStorage.setItem(deptKey, d); } catch {} }
  function show(ok: boolean, text: string) { setFlash({ ok, text }); setTimeout(() => setFlash((f) => (f && f.text === text ? null : f)), 3500); }

  // apply a returned line into local state without a full reload
  function patch(line: Line) { setData((d) => d && { ...d, lines: d.lines.map((l) => (l.id === line.id ? { ...l, ...line } : l)) }); }

  const scan = useCallback(async (code: string): Promise<boolean> => {
    const c = code.trim(); if (!c) return false;
    try {
      const r = await fetch(`/api/pick/${id}/scan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ barcode: c, dept: dept || null }) });
      const j = await r.json();
      if (j.ok) {
        patch(j.line);
        const t = `${label(j.line)} — ${j.line.picked}/${j.line.pick}${j.complete ? " ✓" : ""}`;
        show(true, t); setRecent((xs) => [{ code: c, label: t, qty: 0 }, ...xs].slice(0, 12)); return true;
      }
      if (j.line) patch(j.line);
      const t = j.line ? `${j.message}: ${label(j.line)}` : j.message || "Not on this list";
      show(false, t); setRecent((xs) => [{ code: c, label: t, qty: 0, bad: true }, ...xs].slice(0, 12)); return false;
    } catch { show(false, "Network error – try again"); return false; }
  }, [id, dept]);

  async function gunSubmit(e: React.FormEvent) { e.preventDefault(); const c = gun; setGun(""); const ok = await scan(c); if (ok) beep(); else buzz(); gunRef.current?.focus(); }

  async function override(line: Line, action: "pick" | "undo") {
    const r = await fetch(`/api/pick/${id}/override`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ line: line.id, action }) });
    const j = await r.json(); if (j.line) patch(j.line); setOpenLine(null);
  }
  async function finish() {
    if (!data) return;
    const left = data.lines.filter((l) => l.picked < l.pick);
    const msg = left.length ? `${left.length} line${left.length === 1 ? "" : "s"} not fully picked. Finish anyway? Only what was picked goes to the Sent log.` : "Finish this pick list? It locks the list and records what was sent.";
    if (!confirm(msg)) return;
    setBusy(true);
    const r = await fetch(`/api/pick/${id}/finish`, { method: "POST" }); const j = await r.json();
    if (!r.ok) setErr(j.message || "Could not finish"); await load(); setBusy(false);
  }
  async function rebuild() {
    if (!data || !confirm("Rebuild this list from Shopify now? Picks already made on this list are kept in history but the new list starts fresh.")) return;
    setBusy(true);
    const r = await fetch("/api/pick/build", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId: id }) });
    const j = await r.json(); setBusy(false);
    if (r.ok) window.location.href = `/pick/${j.id}`; else setErr(j.error || "Rebuild failed");
  }

  if (!data) return <>{err ? <div className="err">{err}</div> : <p className="sub">Loading…</p>}</>;
  const { run } = data;
  const finished = run.status !== "open";
  const inDept = data.lines.filter((l) => !dept || l.dept === dept);
  const shown = inDept.filter((l) => !hideDone || l.picked < l.pick);
  const units = inDept.reduce((a, l) => a + l.pick, 0), picked = inDept.reduce((a, l) => a + Math.min(l.picked, l.pick), 0);
  const linesDone = inDept.filter((l) => l.picked >= l.pick).length;
  const counts = { Womens: data.lines.filter((l) => l.dept === "Womens").length, Mens: data.lines.filter((l) => l.dept === "Mens").length };

  return (
    <>
      <div className="row noprint" style={{ justifyContent: "space-between" }}><a href="/pick" className="btn secondary" style={{ padding: "6px 12px" }}>← Pick lists</a>{finished && <span className="pill received">finished</span>}</div>
      <h1 style={{ margin: "8px 0 0" }}>{run.store} <span className="meta" style={{ fontWeight: 400 }}>#{run.id}</span></h1>
      <p className="sub" style={{ marginBottom: 8 }}>Sales {run.label}<br /><span className="meta">{picked} / {units} units · {linesDone} / {inDept.length} lines{finished ? ` · finished by ${run.finished_by}` : ""}</span></p>
      {existing && !finished && <div className="warn noprint">This list was already open for {run.store} on these dates – you&apos;re on the shared one. Rebuild is under More if the stock has changed.</div>}
      {err && <div className="err">{err}</div>}

      <div className="segs noprint">
        {(["", "Womens", "Mens"] as Dept[]).map((d) => <button key={d} type="button" className={dept === d ? "on" : ""} onClick={() => pickDept(d)}>{d || "All"}{d && <small> {counts[d]}</small>}</button>)}
      </div>

      {!finished && (
        <form onSubmit={gunSubmit} className="row noprint" style={{ margin: "10px 0", gap: 8 }}>
          <input ref={gunRef} type="text" inputMode="numeric" autoComplete="off" placeholder="Scan barcode here" value={gun} onChange={(e) => setGun(e.target.value)} style={{ flex: 1, fontSize: 18 }} />
          <button type="button" onClick={() => setCam(true)} style={{ fontSize: 16 }}>📷 Camera</button>
        </form>
      )}
      {flash && <div className={(flash.ok ? "ok" : "err") + " noprint"} style={{ fontWeight: 600 }}>{flash.ok ? "✓ " : "✕ "}{flash.text}</div>}

      <div className="row noprint" style={{ marginBottom: 8, gap: 8 }}>
        <button type="button" className="secondary" onClick={() => setHideDone(!hideDone)}>{hideDone ? "Show picked" : "Hide picked"}</button>
        <details style={{ marginLeft: "auto" }}><summary className="meta" style={{ cursor: "pointer", padding: "8px 4px" }}>More</summary>
          <div className="row" style={{ marginTop: 8, justifyContent: "flex-end" }}>
            <button type="button" className="secondary" onClick={() => window.print()}>Print</button>
            <a className="btn secondary" href={`/api/pick/${id}/manifest`}>Export CSV</a>
            {!finished && <button type="button" className="secondary" onClick={rebuild} disabled={busy}>Rebuild</button>}
            {!finished && <button type="button" onClick={finish} disabled={busy}>Finish</button>}
          </div>
        </details>
      </div>

      <ul className="plist pick">
        {shown.map((l) => {
          const done = l.picked >= l.pick; const open = openLine === l.id;
          return (
            <li key={l.id} className={(done ? "done " : "") + (l.bin ? "" : "noloc ") + (open ? "open" : "")} onClick={() => setOpenLine(open ? null : l.id)}>
              <div className="pbin">{l.bin || "no bin"}</div>
              <div className="pbody"><div className="pname">{l.product}</div><div className="psize">{[l.size, l.colour && !l.product.toLowerCase().includes(l.colour.toLowerCase()) ? l.colour : ""].filter(Boolean).join(" · ")}{!dept && <span className="deptpill">{l.dept}</span>}{l.method === "manual" && <span className="deptpill manual">manual</span>}</div>
                {open && <div className="pactions" onClick={(e) => e.stopPropagation()}>
                  <div className="meta">Sold {l.sold} · store has {l.store_stock} · warehouse {l.wh_stock}{l.sku ? ` · ${l.sku}` : ""}{l.picked_by ? ` · picked by ${l.picked_by}` : ""}</div>
                  {!finished && <div className="row" style={{ marginTop: 6 }}>
                    {!done && <button type="button" className="secondary" onClick={() => override(l, "pick")}>Pick without scanning</button>}
                    {l.picked > 0 && <button type="button" className="secondary" onClick={() => override(l, "undo")}>Undo</button>}
                  </div>}
                </div>}
              </div>
              <div className="pqty">{l.pick > 1 || l.picked > 0 ? <><span className={l.picked ? "got" : ""}>{Math.min(l.picked, l.pick)}</span><small>/{l.pick}</small></> : l.pick}</div>
              <div className="ptick">{done ? "✓" : ""}</div>
            </li>);
        })}
      </ul>
      {shown.length === 0 && <div className="ok">{inDept.length ? "All picked." : "Nothing to pick."}</div>}

      {data.removed.length > 0 && (
        <details className="noprint" style={{ marginTop: 18 }}><summary className="meta" style={{ cursor: "pointer" }}>Sold but not sent ({data.removed.length})</summary>
          <table className="list"><thead><tr><th>Product</th><th>Size</th><th>Sold</th><th>Why</th></tr></thead><tbody>
            {data.removed.map((r, i) => <tr key={i}><td>{r.product}</td><td>{r.size}</td><td>{r.sold}</td><td className="meta">{r.reason}</td></tr>)}
          </tbody></table>
        </details>
      )}

      {cam && <CameraScan continuous onScan={scan} onClose={() => { setCam(false); load(); }} recent={recent} total={picked} hint={`${run.store}${dept ? " · " + dept : ""} — scan each item as you pick it`} totalLabel={`${picked} / ${units} units`} />}
    </>
  );
}
