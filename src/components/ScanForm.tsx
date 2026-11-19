"use client";
import { useCallback, useRef, useState } from "react";
import CameraScan from "./CameraScan";

export default function ScanForm() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [cam, setCam] = useState(false);
  const onScanned = useCallback((c: string) => { setCam(false); setText((t) => (t ? t + "\n" : "") + c.trim() + ",1"); setTimeout(() => setCam(true), 400); }, []);

  // Keyboard-wedge scanner: each scan types the barcode + Enter into the field; we append "barcode,1".
  function onScanKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); const c = code.trim(); if (c) { setText((t) => (t ? t + "\n" : "") + c + ",1"); setCode(""); } }
  }
  const lines = text.split(/\n/).filter((l) => l.trim()).length;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setErr(null);
    const fd = new FormData(e.currentTarget); fd.set("text", text);
    const res = await fetch("/api/putaway/build", { method: "POST", body: fd });
    const j = await res.json();
    setBusy(false);
    if (!res.ok) { setErr(j.error || "Failed"); return; }
    window.location.href = `/putaway/${j.id}` + (j.duplicateOf ? "?dup=" + j.duplicateOf.id : "");
  }

  return (
    <form className="card" onSubmit={submit}>
      {cam && <CameraScan onScan={onScanned} onClose={() => setCam(false)} />}
      <label>Scan file (CSV: Barcode, Quantity)</label>
      <input type="file" name="file" accept=".csv,.txt,text/csv" />
      <label>…or scan here (gun or keyboard – each scan adds 1)</label>
      <div className="row" style={{ margin: "4px 0 8px" }}><button type="button" className="secondary" onClick={() => setCam(true)}>📷 Scan with camera</button></div>
      <input ref={input} type="text" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={onScanKey} placeholder="Scan a barcode" inputMode="numeric" autoComplete="off" />
      <label>Scanned so far {lines ? `(${lines} lines)` : ""} – you can edit quantities here</label>
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={"254221,2\n259413,1"} />
      {err && <div className="err">{err}</div>}
      <div className="row" style={{ marginTop: 12 }}>
        <button type="submit" disabled={busy}>{busy ? "Building…" : "Build put-away list"}</button>
        <button type="button" className="secondary" onClick={() => { setText(""); setCode(""); input.current?.focus(); }}>Clear</button>
      </div>
    </form>
  );
}
