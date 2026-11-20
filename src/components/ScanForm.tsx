"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import CameraScan, { type Recent } from "./CameraScan";

type Item = { qty: number; label: string; bin: string; known: boolean | null };

export default function ScanForm() {
  const [items, setItems] = useState<Record<string, Item>>({});
  const [order, setOrder] = useState<string[]>([]); // most recent first
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cam, setCam] = useState(false);
  const [code, setCode] = useState("");
  const [showText, setShowText] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const itemsRef = useRef(items); itemsRef.current = items;

  // label lookup (product · size · bin) – cached by the server
  async function describe(c: string) {
    try {
      const r = await fetch("/api/find?q=" + encodeURIComponent(c)); const j = await r.json();
      const h = j.hits?.[0];
      setItems((it) => ({ ...it, [c]: { ...(it[c] || { qty: 0 }), label: h && j.mode === "barcode" ? `${h.name}${h.size && h.size !== "One size" ? " · " + h.size : ""}` : "Unknown barcode " + c, bin: h?.bin || "", known: !!(h && j.mode === "barcode") } as Item }));
    } catch { /* leave as code */ }
  }
  const add = useCallback((c: string, n = 1) => {
    const cur = itemsRef.current[c];
    setItems((it) => ({ ...it, [c]: { qty: (it[c]?.qty || 0) + n, label: it[c]?.label || "", bin: it[c]?.bin || "", known: it[c]?.known ?? null } }));
    setOrder((o) => [c, ...o.filter((x) => x !== c)]);
    if (!cur) describe(c);
  }, []);
  const onScanned = useCallback((c: string) => add(c, 1), [add]);
  function setQty(c: string, q: number) {
    setItems((it) => { const n = { ...it }; if (q <= 0) delete n[c]; else n[c] = { ...n[c], qty: q }; return n; });
    if (q <= 0) setOrder((o) => o.filter((x) => x !== c));
  }
  function onGunKey(e: React.KeyboardEvent<HTMLInputElement>) { if (e.key === "Enter") { e.preventDefault(); const c = code.trim(); if (c) { add(c, 1); setCode(""); } } }
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    const text = await f.text();
    for (const line of text.split(/\r?\n/)) { const cells = line.split(/[,\t;]/).map((x) => x.trim().replace(/^"|"$/g, "")); const c = cells[0]?.replace(/\.0$/, ""); if (!c || !/^[A-Za-z0-9._-]+$/.test(c)) continue; const q = cells.length > 1 ? Number(cells[1]) : 1; if (isFinite(q) && q > 0) add(c, q); }
    e.target.value = "";
  }
  const total = Object.values(items).reduce((a, i) => a + i.qty, 0);
  const recent: Recent[] = order.map((c) => ({ code: c, label: items[c]?.label || "", qty: items[c]?.qty || 0 }));
  useEffect(() => { if (!cam) input.current?.focus(); }, [cam]);

  async function submit() {
    setBusy(true); setErr(null);
    const text = order.map((c) => `${c},${items[c].qty}`).join("\n");
    const fd = new FormData(); fd.set("text", text);
    const res = await fetch("/api/putaway/build", { method: "POST", body: fd }); const j = await res.json();
    setBusy(false);
    if (!res.ok) { setErr(j.error || "Failed"); return; }
    window.location.href = `/putaway/${j.id}` + (j.duplicateOf ? "?dup=" + j.duplicateOf.id : "");
  }

  return (
    <div className="card">
      {cam && <CameraScan continuous recent={recent} total={total} onScan={onScanned} onClose={() => setCam(false)} />}
      <div className="row">
        <button type="button" onClick={() => setCam(true)}>📷 Scan</button>
        <label className="btn secondary" style={{ cursor: "pointer" }}>Upload CSV<input type="file" accept=".csv,.txt,text/csv" onChange={onFile} style={{ display: "none" }} /></label>
      </div>
      <label>Barcode gun / type a barcode + Enter</label>
      <input ref={input} type="text" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={onGunKey} placeholder="Scan a barcode" inputMode="numeric" autoComplete="off" />

      {order.length > 0 && (
        <>
          <div className="block-h">{order.length} lines · {total} units</div>
          <ul className="plist">
            {order.map((c) => { const it = items[c]; return (
              <li key={c} className={it.known === false ? "unknown" : ""} style={{ gridTemplateColumns: "1fr 120px", cursor: "default" }}>
                <div className="pbody"><div className="pname">{it.label || c}</div><div className="psize">{it.bin ? "Bin " + it.bin : it.known === false ? "not in Shopify" : it.known === null ? "looking up…" : "no bin"} · {c}</div></div>
                <div className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
                  <button type="button" className="secondary" style={{ padding: "6px 12px" }} onClick={() => setQty(c, it.qty - 1)}>−</button>
                  <strong style={{ minWidth: 24, textAlign: "center", fontSize: 18 }}>{it.qty}</strong>
                  <button type="button" className="secondary" style={{ padding: "6px 12px" }} onClick={() => setQty(c, it.qty + 1)}>+</button>
                </div>
              </li>); })}
          </ul>
        </>
      )}
      {showText ? <textarea readOnly value={order.map((c) => `${c},${items[c].qty}`).join("\n")} style={{ marginTop: 10 }} /> : null}
      {err && <div className="err">{err}</div>}
      <div className="row" style={{ marginTop: 14 }}>
        <button type="button" onClick={submit} disabled={busy || !order.length} >{busy ? "Building…" : `Build put-away list${total ? ` (${total})` : ""}`}</button>
        <button type="button" className="secondary" onClick={() => { setItems({}); setOrder([]); setErr(null); }}>Clear</button>
        <button type="button" className="secondary" onClick={() => setShowText(!showText)} style={{ marginLeft: "auto", fontSize: 13, padding: "6px 10px" }}>{showText ? "Hide" : "Show"} raw</button>
      </div>
    </div>
  );
}
