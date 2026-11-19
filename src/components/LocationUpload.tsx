"use client";
import { useState } from "react";

function parseCsv(text: string): string[][] {
  const out: string[][] = []; let row: string[] = [], cell = "", inq = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inq) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inq = false; } else cell += ch; }
    else if (ch === '"') inq = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); out.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out.filter((r) => r.some((c) => c.trim()));
}

export default function LocationUpload() {
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = (e.currentTarget.elements.namedItem("file") as HTMLInputElement).files?.[0];
    if (!file) return;
    setBusy(true); setMsg(null);
    try {
      const rows = parseCsv(await file.text());
      const hdr = rows[0].map((h) => h.trim().toLowerCase());
      const si = hdr.indexOf("sku"), li = hdr.findIndex((h) => h === "warehouselocation" || h.includes("location"));
      if (si < 0 || li < 0) throw new Error("Need SKU and WarehouseLocation columns. Found: " + rows[0].join(", "));
      const pairs: [string, string][] = [];
      for (const r of rows.slice(1)) { const s = (r[si] || "").trim(), b = (r[li] || "").trim(); if (s && b) pairs.push([s, b]); }
      if (!pairs.length) throw new Error("No SKU/location pairs in the file");
      const post = async (body: unknown) => {
        const r = await fetch("/api/locations/upload", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        const text = await r.text();
        let j: { error?: string } = {};
        try { j = JSON.parse(text); } catch { throw new Error(`Server replied ${r.status} ${r.statusText}: ${text.replace(/<[^>]+>/g, " ").trim().slice(0, 200) || "(empty)"}`); }
        if (!r.ok) throw new Error(j.error || `Upload failed (${r.status})`);
        return j;
      };
      await post({ mode: "start" });
      for (let i = 0; i < pairs.length; i += 1000) { await post({ mode: "append", rows: pairs.slice(i, i + 1000) }); setMsg({ t: `Uploading… ${Math.min(i + 1000, pairs.length).toLocaleString()} / ${pairs.length.toLocaleString()}`, ok: true }); }
      await post({ mode: "finish", file: file.name, total: pairs.length });
      setMsg({ t: `Loaded ${pairs.length.toLocaleString()} SKU locations from ${file.name}.`, ok: true });
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) { setMsg({ t: err instanceof Error ? err.message : String(err), ok: false }); }
    setBusy(false);
  }
  return (
    <form onSubmit={onSubmit}>
      <label>ShipStation CSV</label><input type="file" name="file" accept=".csv,text/csv" required />
      {msg && <div className={msg.ok ? "ok" : "err"}>{msg.t}</div>}
      <div style={{ marginTop: 12 }}><button type="submit" disabled={busy}>{busy ? "Uploading…" : "Upload"}</button> <a className="btn secondary" href="/">Back</a></div>
    </form>
  );
}
