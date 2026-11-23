"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import CameraScan, { beep, buzz, type Recent } from "./CameraScan";

type Line = { id: number; sku: string; barcode: string; product: string; size: string; colour: string; dept: string; bin: string; sold: number; store_stock: number; wh_stock: number; pick: number; picked: number; picked_by: string | null; method: string | null; note?: string };
type Run = { id: number; store: string; label: string; status: string; created_at: string; created_by: string; finished_at: string | null; finished_by: string | null; lines: number; units: number; removed: number; orders?: { number: string; name: string; items: number; shipment_id?: string }[]; preview?: boolean; tag?: string | null };
type Removed = { product: string; size: string; colour: string; sku: string; sold: number; reason: string };
type Data = { run: Run; lines: Line[]; removed: Removed[] };
type Dept = string;

const label = (l: Line) => `${l.product} · ${l.size}${l.colour && !l.product.toLowerCase().includes(l.colour.toLowerCase()) ? " · " + l.colour : ""}`;

export type PickConfig = { api: string; backHref: string; backLabel: string; title: (run: Run) => string; subtitle: (run: Run) => string; tabs: string[]; rebuild: boolean; manifest: boolean; existingNote?: string; finishNote?: string; scanHint: string; gun?: boolean; nameRequired?: boolean; finishLabel?: string; extraLinks?: { label: string; href: (id: number) => string }[]; removedTitle?: string };
export const STORE_CONFIG: PickConfig = { api: "/api/pick", backHref: "/pick", backLabel: "Store replen", title: (r) => r.store, subtitle: (r) => `Sales ${r.label}`, tabs: ["Womens", "Mens"], rebuild: true, manifest: true, existingNote: "This list was already open for this store on these dates – you're on the shared one. Rebuild is under More if the stock has changed.", finishNote: "Finish this pick list? It locks the list and records what was sent.", scanHint: "scan each item as you pick it", gun: true };

export default function PickView({ id, existing, cfg = STORE_CONFIG }: { id: number; existing?: boolean; cfg?: PickConfig }) {
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
  const [who, setWho] = useState("");
  useEffect(() => { try { setWho(localStorage.getItem("ops-name") || localStorage.getItem("putaway-name") || ""); } catch {} }, []);
  function saveWho(v: string) { setWho(v); try { localStorage.setItem("ops-name", v); } catch {} }
  const deptKey = `${cfg.api}-dept:${id}`;

  const load = useCallback(async () => {
    try { const r = await fetch(`${cfg.api}/${id}`, { cache: "no-store" }); const j = await r.json(); if (!r.ok) throw new Error(j.error || "Failed"); setData(j); setErr(null); }
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
      const r = await fetch(`${cfg.api}/${id}/scan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ barcode: c, dept: dept || null, by: who || undefined }) });
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
  }, [id, dept, who]);

  async function gunSubmit(e: React.FormEvent) { e.preventDefault(); const c = gun; setGun(""); if (!c.trim()) return; const ok = await scan(c); if (ok) beep(); else buzz(); gunRef.current?.focus(); }
  // Gun mode: the barcode box stays focused (no on-screen keyboard), and keystrokes that land anywhere else on the page are
  // captured too, so a wedge-style scanner (RFID gun's barcode reader) can just keep firing "code + Enter".
  const buf = useRef(""); const bufAt = useRef(0);
  useEffect(() => {
    if (!cfg.gun || !data || data.run.status !== "open" || cam) return;
    const focus = () => { const el = gunRef.current; if (el && document.activeElement !== el) el.focus({ preventScroll: true }); };
    focus();
    const onKey = (e: KeyboardEvent) => {
      if (document.activeElement === gunRef.current) return; // normal path – input handles it
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const now = Date.now(); if (now - bufAt.current > 400) buf.current = ""; bufAt.current = now;
      if (e.key === "Enter") { const c = buf.current; buf.current = ""; if (c.length >= 4) { e.preventDefault(); scan(c).then((ok) => { if (ok) beep(); else buzz(); }); focus(); } return; }
      if (e.key.length === 1) buf.current += e.key;
    };
    const onVis = () => { if (document.visibilityState === "visible") setTimeout(focus, 50); };
    document.addEventListener("keydown", onKey); document.addEventListener("visibilitychange", onVis);
    const t = setInterval(focus, 1500); // tapping a line/button steals focus – take it back quietly
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("visibilitychange", onVis); clearInterval(t); };
  }, [data, cam, scan, cfg.gun]);

  async function override(line: Line, action: "pick" | "undo" | "skip") {
    const r = await fetch(`${cfg.api}/${id}/override`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ line: line.id, action, by: who || undefined }) });
    const j = await r.json(); if (j.line) patch(j.line); setOpenLine(null);
  }
  async function finish() {
    if (!data) return;
    const left = data.lines.filter((l) => l.picked < l.pick && l.method !== "skipped"); const sk = data.lines.filter((l) => l.method === "skipped").length;
    const msg = left.length ? `${left.length} line${left.length === 1 ? "" : "s"} not fully picked${sk ? ` (plus ${sk} skipped)` : ""}. Finish anyway? Only what was picked goes to the Sent log.` : (cfg.finishNote || "Finish this list?") + (sk ? ` ${sk} skipped line${sk === 1 ? "" : "s"} will not be sent.` : "");
    if (cfg.nameRequired && !who.trim()) { setErr("Put your name in first (top of the page)."); return; }
    if (!confirm(msg)) return;
    setBusy(true);
    const r = await fetch(`${cfg.api}/${id}/finish`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ by: who || undefined }) }); const j = await r.json();
    if (!r.ok) setErr(j.message || "Could not finish"); else if (j.units) setFlash({ ok: true, text: `Done – ${j.units} units across ${j.sent} lines adjusted in Shopify.` }); await load(); setBusy(false);
  }
  async function rebuild() {
    if (!data || !confirm("Rebuild this list from Shopify now? Picks already made on this list are kept in history but the new list starts fresh.")) return;
    setBusy(true);
    const r = await fetch(`${cfg.api}/build`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId: id }) });
    const j = await r.json(); setBusy(false);
    if (r.ok) window.location.href = `${cfg.backHref}/${j.id}`; else setErr(j.error || "Rebuild failed");
  }

  if (!data) return <>{err ? <div className="err">{err}</div> : <p className="sub">Loading…</p>}</>;
  const { run } = data;
  const finished = run.status !== "open";
  const inDept = data.lines.filter((l) => !dept || l.dept === dept);
  const isDone = (l: Line) => l.picked >= l.pick || l.method === "skipped";
  const shown = inDept.filter((l) => !hideDone || !isDone(l));
  const skippedCount = inDept.filter((l) => l.method === "skipped").length;
  const units = inDept.reduce((a, l) => a + l.pick, 0), picked = inDept.reduce((a, l) => a + Math.min(l.picked, l.pick), 0);
  const linesDone = inDept.filter((l) => l.picked >= l.pick).length;
  const counts: Record<string, number> = {}; for (const t of cfg.tabs) counts[t] = data.lines.filter((l) => l.dept === t).length;

  return (
    <>
      <div className="row noprint" style={{ justifyContent: "space-between" }}><a href={cfg.backHref} className="btn secondary">← {cfg.backLabel}</a>{finished && <span className="pill received">finished</span>}{run.preview && <span className="pill">preview</span>}</div>
      <h1 style={{ margin: "8px 0 0" }}>{cfg.title(run)} <span className="meta" style={{ fontWeight: 400 }}>#{run.id}</span></h1>
      <p className="sub" style={{ marginBottom: 8 }}>{cfg.subtitle(run)}<br /><span className="meta">{picked} / {units} units · {linesDone} / {inDept.length} lines{skippedCount ? ` · ${skippedCount} skipped` : ""}{finished ? ` · finished by ${run.finished_by}` : ""}</span></p>
      {existing && !finished && cfg.existingNote && <div className="warn noprint">{cfg.existingNote}</div>}
      {err && <div className="err">{err}</div>}
      {cfg.nameRequired && !finished && <div className="row noprint" style={{ margin: "4px 0 8px" }}><label style={{ margin: 0 }}>Your name</label><input type="text" value={who} onChange={(e) => saveWho(e.target.value)} placeholder="e.g. Kirsten" style={{ maxWidth: 200 }} /></div>}

      <div className="segs noprint">
        {["", ...cfg.tabs].map((d) => <button key={d} type="button" className={dept === d ? "on" : ""} onClick={() => pickDept(d)}>{d || "All"}{d && <small> {counts[d]}</small>}</button>)}
      </div>

      {!finished && (
        <form onSubmit={gunSubmit} className="row noprint" style={{ margin: "10px 0", gap: 8 }}>
          <input ref={gunRef} type="text" inputMode={cfg.gun ? "none" : "numeric"} autoComplete="off" autoFocus={!!cfg.gun} placeholder={cfg.gun ? "Gun ready – just scan (or use 📷)" : "Scan barcode here"} value={gun} onChange={(e) => setGun(e.target.value)} style={cfg.gun ? { flex: 1, background: "#f3fbf5", borderColor: "#7ccc92" } : { flex: 1 }} />
          <button type="button" onClick={() => setCam(true)}>📷 Scan</button>
        </form>
      )}
      {flash && <div className={(flash.ok ? "ok" : "err") + " noprint"} style={{ fontWeight: 600 }}>{flash.ok ? "✓ " : "✕ "}{flash.text}</div>}

      <div className="row noprint" style={{ marginBottom: 8, gap: 8 }}>
        <button type="button" className="secondary" onClick={() => setHideDone(!hideDone)}>{hideDone ? "Show picked" : "Hide picked"}</button>
        {cfg.finishLabel && !finished && <button type="button" onClick={finish} disabled={busy || picked === 0}>{cfg.finishLabel}{picked ? ` (${picked})` : ""}</button>}
        <details style={{ marginLeft: "auto" }}><summary className="meta" style={{ cursor: "pointer", padding: "8px 4px" }}>More</summary>
          <div className="row" style={{ marginTop: 8, justifyContent: "flex-end" }}>
            <button type="button" className="secondary" onClick={() => window.print()}>Print</button>
            {cfg.manifest && <a className="btn secondary" href={`${cfg.api}/${id}/manifest`}>Export CSV</a>}
            {cfg.extraLinks?.map((x) => <a key={x.label} className="btn secondary" href={x.href(id)}>{x.label}</a>)}
            {!finished && cfg.rebuild && <button type="button" className="secondary" onClick={rebuild} disabled={busy}>Rebuild</button>}
            {!finished && <button type="button" onClick={finish} disabled={busy}>{cfg.finishLabel || "Finish"}</button>}
          </div>
        </details>
      </div>

      <ul className="plist pick">
        {shown.map((l) => {
          const done = isDone(l); const skipped = l.method === "skipped"; const open = openLine === l.id;
          return (
            <li key={l.id} className={(done ? "done " : "") + (l.bin ? "" : "noloc ") + (open ? "open" : "")} onClick={() => setOpenLine(open ? null : l.id)}>
              <div className="pbin">{l.bin || "no bin"}</div>
              <div className="pbody"><div className="pname">{l.product}</div><div className="psize">{[l.size, l.colour && !l.product.toLowerCase().includes(l.colour.toLowerCase()) ? l.colour : ""].filter(Boolean).join(" · ")}{!dept && <span className="deptpill">{l.dept}</span>}{l.method === "manual" && <span className="deptpill manual">manual</span>}{skipped && <span className="deptpill skipped">skipped</span>}</div>{l.note && <div className="pnote">{l.note}</div>}
                {open && <div className="pactions" onClick={(e) => e.stopPropagation()}>
                  <div className="meta">Sold {l.sold} · store has {l.store_stock} · warehouse {l.wh_stock}{l.sku ? ` · ${l.sku}` : ""}{l.picked_by ? ` · picked by ${l.picked_by}` : ""}</div>
                  {!finished && <div className="row" style={{ marginTop: 6 }}>
                    {!done && <button type="button" className="secondary" onClick={() => override(l, "pick")}>Pick without scanning</button>}
                    {!done && <button type="button" className="secondary" onClick={() => override(l, "skip")}>Skip – can&apos;t send</button>}
                    {(l.picked > 0 || skipped) && <button type="button" className="secondary" onClick={() => override(l, "undo")}>Undo</button>}
                  </div>}
                </div>}
              </div>
              <div className="pqty">{l.pick > 1 || l.picked > 0 ? <><span className={l.picked ? "got" : ""}>{Math.min(l.picked, l.pick)}</span><small>/{l.pick}</small></> : l.pick}</div>
              <div className="ptick">{skipped ? "–" : done ? "✓" : ""}</div>
            </li>);
        })}
      </ul>
      {shown.length === 0 && <div className="ok">{inDept.length ? "All picked." : "Nothing to pick."}</div>}

      {run.orders && run.orders.length > 0 && (
        <details className="noprint" style={{ marginTop: 18 }}><summary className="meta" style={{ cursor: "pointer" }}>Orders in this wave ({run.orders.length})</summary>
          <table className="list"><thead><tr><th>Order</th><th>Customer</th><th>Items</th></tr></thead><tbody>
            {run.orders.map((o) => <tr key={o.number}><td>{o.number}</td><td>{o.name}</td><td>{o.items}</td></tr>)}
          </tbody></table>
        </details>
      )}
      {data.removed.length > 0 && (
        <details className="noprint" style={{ marginTop: 18 }}><summary className="meta" style={{ cursor: "pointer" }}>{cfg.removedTitle || "Sold but not sent"} ({data.removed.length})</summary>
          <table className="list"><thead><tr><th>Product</th><th>Size</th><th>Sold</th><th>Why</th></tr></thead><tbody>
            {data.removed.map((r, i) => <tr key={i}><td>{r.product}</td><td>{r.size}</td><td>{r.sold}</td><td className="meta">{r.reason}</td></tr>)}
          </tbody></table>
        </details>
      )}

      {cam && <CameraScan continuous nextItem={!cfg.gun ? undefined : (() => { const n = shown.find((l) => !isDone(l)); return n ? { bin: n.bin, product: n.product, size: n.size, qty: n.pick - n.picked } : null; })()} onSkip={!cfg.gun || finished ? undefined : () => { const n = shown.find((l) => !isDone(l)); if (n && confirm(`Skip ${n.product} ${n.size}? It stays on the list marked skipped and won't go to the store.`)) override(n, "skip"); }} onScan={scan} onClose={() => { setCam(false); load(); }} recent={recent} total={picked} hint={`${cfg.title(run)}${dept ? " · " + dept : ""} — ${cfg.scanHint}`} totalLabel={`${picked} / ${units} units`} />}
    </>
  );
}
