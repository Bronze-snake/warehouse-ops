"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import CameraScan from "./CameraScan";
type Hit = { sku: string; bin: string; name: string; size?: string; colour?: string; via: string };

export default function Finder() {
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [trace, setTrace] = useState<{ batch_id: number; qty: number; bin: string; created_at: string; created_by: string; received_at: string | null; received_by: string | null }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cam, setCam] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { input.current?.focus(); }, []);

  async function search(t: string) {
    const s = t.trim(); if (!s) { setHits(null); return; }
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/find?q=" + encodeURIComponent(s));
      const j = await r.json(); if (!r.ok) throw new Error(j.error || "Search failed");
      setHits(j.hits); setTrace(j.trace || []);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  }
  function onChange(v: string) {
    setTerm(v);
    if (timer.current) clearTimeout(timer.current);
    if (v.trim().length >= 3 && !/^\d+$/.test(v.trim())) timer.current = setTimeout(() => search(v), 350); // names search as you type; barcodes wait for Enter
  }
  function onKey(e: React.KeyboardEvent<HTMLInputElement>) { if (e.key === "Enter") { e.preventDefault(); if (timer.current) clearTimeout(timer.current); search(term); } }
  function clear() { setTerm(""); setHits(null); setErr(null); input.current?.focus(); }

  const onScanned = useCallback((code: string) => { setCam(false); setTerm(code); search(code); }, []);
  const first = hits?.[0];
  return (
    <>
      {cam && <CameraScan onScan={onScanned} onClose={() => setCam(false)} />}
      <div className="card">
        <input ref={input} type="text" value={term} onChange={(e) => onChange(e.target.value)} onKeyDown={onKey} placeholder="Scan or type…" autoComplete="off" style={{ fontSize: 22, padding: 14 }} />
        <div className="row" style={{ marginTop: 10 }}><button type="button" onClick={() => setCam(true)}>📷 Scan</button><button type="button" className="secondary" onClick={() => search(term)} disabled={busy}>{busy ? "Looking…" : "Find"}</button><button type="button" className="secondary" onClick={clear}>Clear</button></div>
        <p className="meta" style={{ margin: "8px 0 0" }}>A barcode gun also works – just scan with the box selected.</p>
        {err && <div className="err">{err}</div>}
      </div>
      {hits && hits.length === 0 && <div className="warn">Nothing found for “{term}”. Check the spelling, or it may have no bin in ShipStation yet.</div>}
      {first && first.via === "barcode" && (
        <div className="card" style={{ textAlign: "center", padding: 28 }}>
          <div style={{ fontSize: 64, fontWeight: 800, letterSpacing: ".02em", lineHeight: 1 }}>{first.bin || "NO BIN"}</div>
          <div style={{ fontSize: 20, marginTop: 10 }}>{first.name}</div>
          <div className="meta">{[first.size, first.colour].filter(Boolean).join(" · ")} · {first.sku}</div>
          {trace.length > 0 && (
            <div style={{ textAlign: "left", marginTop: 16, borderTop: "1px solid #eee", paddingTop: 10 }}>
              <div className="meta" style={{ fontWeight: 600, marginBottom: 4 }}>Last put away</div>
              {trace.map((t) => <div key={t.batch_id} style={{ fontSize: 14, padding: "3px 0" }}>{new Date(t.received_at || t.created_at).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · <strong>{t.received_by || t.created_by}</strong> · {t.qty} to {t.bin || "no bin"} · <a href={`/putaway/${t.batch_id}`}>batch #{t.batch_id}</a>{!t.received_at && <span className="meta"> (not received)</span>}</div>)}
            </div>
          )}
        </div>
      )}
      {hits && hits.length > (first?.via === "barcode" ? 1 : 0) && (
        <table className="list"><thead><tr><th>Bin</th><th>Product</th><th>Size</th><th>SKU</th></tr></thead>
          <tbody>{hits.slice(first?.via === "barcode" ? 1 : 0).map((h) => (
            <tr key={h.sku} className={h.bin ? "" : "noloc"}><td className="bin" style={{ fontSize: 18 }}>{h.bin || "no bin"}</td><td>{h.name}</td><td>{h.size || ""}</td><td className="meta">{h.sku}</td></tr>
          ))}</tbody></table>
      )}
    </>
  );
}
