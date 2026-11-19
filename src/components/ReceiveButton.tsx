"use client";
import { useState } from "react";

export default function ReceiveButton({ id, status, units, lines, unknown }: { id: number; status: string; units: number; lines: number; unknown: number }) {
  const [state, setState] = useState<{ busy: boolean; msg?: string; ok?: boolean; dup?: boolean }>({ busy: false });
  if (status === "received") return <div className="ok">Received into Preston – stock is in Shopify.</div>;
  async function go(force = false) {
    if (!confirm(`Add ${units} units across ${lines} variants to Online Warehouse (Preston)?\n\nThis replaces the Easy Scan upload – don't do both.${unknown ? `\n\n${unknown} unknown barcode(s) will be skipped.` : ""}`)) return;
    setState({ busy: true });
    const res = await fetch("/api/putaway/receive", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, force }) });
    const j = await res.json();
    if (j.ok) { setState({ busy: false, ok: true, msg: `Done – ${j.units} units added to Preston.` }); setTimeout(() => window.location.reload(), 800); }
    else setState({ busy: false, ok: false, msg: j.reason, dup: !!j.duplicateOf });
  }
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div><strong>Receive into Preston</strong><div className="meta">Adds {units} units across {lines} variants to Online Warehouse. One click, one confirm.</div></div>
        <button onClick={() => go(false)} disabled={state.busy || !lines}>{state.busy ? "Posting…" : "Receive into Preston"}</button>
      </div>
      {state.msg && <div className={state.ok ? "ok" : "err"} style={{ marginBottom: 0 }}>{state.msg}
        {state.dup && <div style={{ marginTop: 8 }}><button className="danger" onClick={() => go(true)}>This is a separate delivery – receive anyway</button></div>}
      </div>}
    </div>
  );
}
