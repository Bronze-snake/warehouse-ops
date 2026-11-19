"use client";
import { useEffect, useRef, useState } from "react";
type Hit = { sku: string; bin: string; name: string; size?: string; colour?: string; via: string };

export default function Finder() {
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { input.current?.focus(); }, []);

  async function search(t: string) {
    const s = t.trim(); if (!s) { setHits(null); return; }
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/find?q=" + encodeURIComponent(s));
      const j = await r.json(); if (!r.ok) throw new Error(j.error || "Search failed");
      setHits(j.hits);
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

  const first = hits?.[0];
  return (
    <>
      <div className="card">
        <input ref={input} type="text" value={term} onChange={(e) => onChange(e.target.value)} onKeyDown={onKey} placeholder="Scan or type…" autoComplete="off" style={{ fontSize: 22, padding: 14 }} />
        <div className="row" style={{ marginTop: 10 }}><button type="button" onClick={() => search(term)} disabled={busy}>{busy ? "Looking…" : "Find"}</button><button type="button" className="secondary" onClick={clear}>Clear</button></div>
        {err && <div className="err">{err}</div>}
      </div>
      {hits && hits.length === 0 && <div className="warn">Nothing found for “{term}”. Check the spelling, or it may have no bin in ShipStation yet.</div>}
      {first && first.via === "barcode" && (
        <div className="card" style={{ textAlign: "center", padding: 28 }}>
          <div style={{ fontSize: 64, fontWeight: 800, letterSpacing: ".02em", lineHeight: 1 }}>{first.bin || "NO BIN"}</div>
          <div style={{ fontSize: 20, marginTop: 10 }}>{first.name}</div>
          <div className="meta">{[first.size, first.colour].filter(Boolean).join(" · ")} · {first.sku}</div>
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
