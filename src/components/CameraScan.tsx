"use client";
import { useEffect, useRef, useState } from "react";

// Phone-camera barcode scanner. Native BarcodeDetector when the browser has one (fast), ZXing otherwise.
// Calls onScan(code) once per read, then stops.
type Detector = { detect: (src: ImageBitmapSource) => Promise<{ rawValue: string }[]> };
declare global { interface Window { BarcodeDetector?: new (o?: { formats?: string[] }) => Detector & { constructor: { getSupportedFormats?: () => Promise<string[]> } } } }

export function beep() {
  try { const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext; const ctx = new C(); const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = "square"; o.frequency.value = 1400; g.gain.value = 0.15; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.09); setTimeout(() => ctx.close(), 300); } catch {}
  try { navigator.vibrate?.(60); } catch {}
}

export function buzz() {
  try { const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext; const ctx = new C(); const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = "sawtooth"; o.frequency.value = 180; g.gain.value = 0.2; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.35); setTimeout(() => ctx.close(), 600); } catch {}
  try { navigator.vibrate?.([120, 60, 120]); } catch {}
}

export type Recent = { code: string; label: string; qty: number; bad?: boolean };

export default function CameraScan({ onScan, onClose, continuous = false, recent = [], total = 0, hint, totalLabel, next, nextItem }: { onScan: (code: string) => void | boolean | Promise<void | boolean>; onClose: () => void; continuous?: boolean; recent?: Recent[]; total?: number; hint?: string; totalLabel?: string; next?: string; nextItem?: { bin: string; product: string; size: string; qty: number } | null }) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [engine, setEngine] = useState("");
  const [flash, setFlash] = useState(false);
  const [bad, setBad] = useState(false);
  const last = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  useEffect(() => {
    let stopped = false; let stream: MediaStream | null = null; let zx: { stop: () => void } | null = null; let raf = 0;
    const finish = (raw: string) => {
      if (stopped) return;
      const t = raw.trim(); const now = Date.now();
      if (continuous) {
        if (t === last.current.code && now - last.current.at < 1800) return; // same label still in view
        last.current = { code: t, at: now };
        Promise.resolve(onScan(t)).then((ok) => { if (ok === false) { buzz(); setBad(true); setTimeout(() => setBad(false), 500); } else { beep(); setFlash(true); setTimeout(() => setFlash(false), 250); } }); return;
      }
      stopped = true; beep(); cleanup(); onScan(t);
    };
    const cleanup = () => { cancelAnimationFrame(raf); if (zx) zx.stop(); if (stream) stream.getTracks().forEach((tr) => tr.stop()); };
    (async () => {
      try {
        const v = video.current!;
        if (window.BarcodeDetector) {
          // --- native path ---
          setEngine("native");
          const det = new window.BarcodeDetector({ formats: ["code_128", "code_39", "ean_13", "ean_8", "upc_a", "upc_e", "itf", "codabar", "qr_code"] });
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
          v.srcObject = stream; await v.play();
          try { await stream.getVideoTracks()[0].applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }); } catch {}
          let busy = false;
          const tick = async () => {
            if (stopped) return;
            if (!busy && v.readyState >= 2) {
              busy = true;
              try { const codes = await det.detect(v); if (codes.length && codes[0].rawValue) { finish(codes[0].rawValue); return; } } catch {}
              busy = false;
            }
            raf = requestAnimationFrame(tick);
          };
          raf = requestAnimationFrame(tick);
        } else {
          // --- ZXing path ---
          setEngine("zxing");
          const { BrowserMultiFormatReader } = await import("@zxing/browser");
          const { BarcodeFormat, DecodeHintType } = await import("@zxing/library");
          const hints = new Map();
          hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.ITF, BarcodeFormat.CODABAR, BarcodeFormat.QR_CODE]);
          hints.set(DecodeHintType.TRY_HARDER, true);
          const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 80, delayBetweenScanSuccess: 500 });
          const controls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } }, v, (result) => { if (result) finish(result.getText()); });
          zx = controls;
          try { const s = v.srcObject as MediaStream | null; await s?.getVideoTracks()[0].applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }); } catch {}
        }
      } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    })();
    return cleanup;
  }, [onScan, continuous]);
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 50, display: "flex", flexDirection: "column" }}>
      <div style={nextItem !== undefined ? { position: "relative", height: "34vh", flex: "none", overflow: "hidden" } : { position: "relative", flex: 1, minHeight: 0, overflow: "hidden" }}>
      <video ref={video} style={{ width: "100%", height: "100%", objectFit: "cover" }} muted playsInline autoPlay />
      <div style={{ position: "absolute", left: "8%", right: "8%", top: "32%", height: "32%", border: `3px solid ${bad ? "#ff4d4d" : flash ? "#3ddc84" : "rgba(255,255,255,.85)"}`, borderRadius: 8, pointerEvents: "none", boxShadow: "0 0 0 2000px rgba(0,0,0,.25)", transition: "border-color .1s" }} />
      <div style={{ position: "absolute", top: 10, left: 0, right: 0, textAlign: "center", color: "#fff", fontSize: 13, textShadow: "0 1px 3px #000" }}>{continuous ? (hint || "Scan each item – it beeps when it's in") : "Line the barcode up in the box · hold steady"}{engine === "zxing" ? " · 1–2 s" : ""}</div>
      {err && <div className="err" style={{ position: "absolute", left: 16, right: 16, top: 48 }}>Camera: {err}. Allow camera access for this site, or type the barcode.</div>}
      </div>
      {continuous && (
        <div style={{ background: "#111", color: "#fff", padding: "10px 14px 0", flex: 1, minHeight: 0, overflow: "auto" }}>
          {nextItem !== undefined && (nextItem ? (
            <div style={{ background: "#1d4ed8", borderRadius: 12, padding: "12px 14px", marginBottom: 10, boxShadow: "0 4px 14px rgba(29,78,216,.45)" }}>
              <div style={{ fontSize: 11, color: "#bfdbfe", letterSpacing: ".08em", fontWeight: 700 }}>PICK NEXT</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 2 }}><span style={{ fontSize: 34, fontWeight: 900, letterSpacing: ".02em" }}>{nextItem.bin || "no bin"}</span>{nextItem.qty > 1 && <span style={{ fontSize: 20, fontWeight: 800, background: "#fff", color: "#1d4ed8", borderRadius: 999, padding: "0 10px" }}>×{nextItem.qty}</span>}</div>
              <div style={{ fontSize: 19, fontWeight: 700, lineHeight: 1.2, marginTop: 2 }}>{nextItem.product}</div>
              <div style={{ fontSize: 16, color: "#dbeafe", marginTop: 2 }}>Size {nextItem.size}</div>
            </div>
          ) : <div style={{ background: "#166534", borderRadius: 12, padding: "14px", marginBottom: 10, fontSize: 18, fontWeight: 700 }}>All picked ✓</div>)}
          {next && nextItem === undefined && <div style={{ background: "#2a2a2a", borderRadius: 8, padding: "8px 10px", marginBottom: 8 }}><div style={{ fontSize: 11, color: "#aaa", letterSpacing: ".06em" }}>NEXT</div><div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.2 }}>{next}</div></div>}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><span style={{ color: "#aaa", fontSize: 13 }}>{totalLabel || `${total} scanned`}</span><span style={{ color: "#aaa", fontSize: 13 }}>latest first</span></div>
          {recent.slice(0, 6).map((r, i) => (
            <div key={r.code + i} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "7px 0", borderTop: "1px solid #333", fontSize: i === 0 ? 17 : 14, fontWeight: i === 0 ? 700 : 400, color: r.bad ? "#ff8a80" : i === 0 ? "#fff" : "#ccc" }}>
              <span style={{ flex: 1, lineHeight: 1.25 }}>{r.label || r.code}</span><span style={{ fontWeight: 700 }}>{r.bad ? "✕" : r.qty ? `×${r.qty}` : "✓"}</span>
            </div>))}
          {!recent.length && <div style={{ color: "#aaa", padding: "8px 0 4px" }}>Nothing scanned yet.</div>}
        </div>
      )}
      <div style={{ padding: 12, textAlign: "center", background: "#111", display: "flex", gap: 10, justifyContent: "center" }}>
        {continuous ? <button type="button" onClick={onClose} style={{ flex: 1, fontSize: 18 }}>Done{totalLabel ? "" : ` (${total})`}</button> : <button className="secondary" type="button" onClick={onClose}>Cancel</button>}
      </div>
    </div>
  );
}
