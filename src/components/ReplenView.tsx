"use client";
import { useEffect, useState } from "react";
type Line = { sku: string; product: string; size: string; colour: string; dept: string; units: number; orders: number; bin: string };
type Data = { window: string; start: string; lines: Line[]; orders: number; scanned: number; builtAt: string; cached?: boolean };

const binSort = (a: string, b: string) => { const tok = (s: string) => s.toUpperCase().match(/[A-Z]+|\d+/g) || []; const ta = tok(a), tb = tok(b); for (let i = 0; i < Math.max(ta.length, tb.length); i++) { if (ta[i] === undefined) return -1; if (tb[i] === undefined) return 1; const na = /^\d+$/.test(ta[i]), nb = /^\d+$/.test(tb[i]); if (na && nb) { const d = +ta[i] - +tb[i]; if (d) return d; } else if (ta[i] !== tb[i]) return ta[i] < tb[i] ? -1 : 1; } return 0; };

export default function ReplenView() {
  const [day, setDay] = useState("");
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sort, setSort] = useState<"units" | "bin">("units");
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [hideDone, setHideDone] = useState(false);
  const key = data ? "replen-done:" + data.start : "";

  async function load(fresh = false, d = day) {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/replen?${d ? "day=" + d + "&" : ""}${fresh ? "fresh=1" : ""}`);
      const j = await r.json(); if (!r.ok) throw new Error(j.error || "Failed"); setData(j);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => { if (!key) return; try { setDone(JSON.parse(localStorage.getItem(key) || "{}")); } catch { setDone({}); } }, [key]);
  function toggle(id: string) { const n = { ...done, [id]: !done[id] }; setDone(n); try { localStorage.setItem(key, JSON.stringify(n)); } catch {} }

  const lines = data ? [...data.lines].sort(sort === "units" ? (a, b) => b.units - a.units || a.product.localeCompare(b.product) : (a, b) => (a.bin ? 0 : 1) - (b.bin ? 0 : 1) || binSort(a.bin, b.bin) || a.product.localeCompare(b.product)) : [];
  const id = (l: Line) => l.sku || l.product + "|" + l.size;
  const total = lines.reduce((a, l) => a + l.units, 0);
  const doneCount = lines.filter((l) => done[id(l)]).length;
  const shown = hideDone ? lines.filter((l) => !done[id(l)]) : lines;

  return (
    <>
      <h1 style={{ marginBottom: 2 }}>Warehouse replen</h1>
      {data && <p className="sub" style={{ marginBottom: 10 }}>{data.window}<br /><span className="meta">{lines.length} lines · {total} units · {doneCount} done</span></p>}
      {!data && !err && <p className="sub">Building…</p>}
      <div className="row noprint" style={{ marginBottom: 12, gap: 8 }}>
        <button type="button" className="secondary" onClick={() => setSort(sort === "units" ? "bin" : "units")}>{sort === "units" ? "Sort by bin" : "Sort by most sold"}</button>
        <button type="button" className="secondary" onClick={() => setHideDone(!hideDone)}>{hideDone ? "Show done" : "Hide done"}</button>
        <details style={{ marginLeft: "auto" }}><summary className="meta" style={{ cursor: "pointer" }}>More</summary>
          <div className="row" style={{ marginTop: 8 }}>
            <input type="date" value={day} onChange={(e) => setDay(e.target.value)} style={{ width: "auto", padding: 8 }} />
            <button type="button" className="secondary" onClick={() => load(true)} disabled={busy}>{busy ? "Building…" : "Run"}</button>
            <button type="button" className="secondary" onClick={() => window.print()}>Print</button>
            <button type="button" className="secondary" onClick={() => { setDone({}); try { localStorage.removeItem(key); } catch {} }}>Reset ticks</button>
          </div>
        </details>
      </div>
      {err && <div className="err">{err}</div>}
      {data && (
        <ul className="plist">
          {shown.map((l) => { const k = id(l); const d = !!done[k]; return (
            <li key={k} className={(d ? "done " : "") + (l.bin ? "" : "noloc")} onClick={() => toggle(k)}>
              <div className="pbin">{l.bin || "no bin"}</div>
              <div className="pbody"><div className="pname">{l.product}</div><div className="psize">{[l.size, l.colour && !l.product.toLowerCase().includes(l.colour.toLowerCase()) ? l.colour : ""].filter(Boolean).join(" · ")}</div></div>
              <div className="pqty">{l.units}</div>
              <div className="ptick">{d ? "✓" : ""}</div>
            </li>); })}
        </ul>
      )}
      {data && shown.length === 0 && <div className="ok">All done.</div>}
    </>
  );
}
