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

export default function CameraScan({ onScan, onClose, continuous = false, recent = [], total = 0, hint, totalLabel, next, nextItem, onSkip, compact: compactProp }: { onScan: (code: string) => void | boolean | Promise<void | boolean>; onClose: () => void; continuous?: boolean; recent?: Recent[]; total?: number; hint?: string; totalLabel?: string; next?: string; nextItem?: { bin: string; product: string; size: string; qty: number } | null; onSkip?: () => void; compact?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [engine, setEngine] = useState("");
  const [flash, setFlash] = useState(false);
  const [bad, setBad] = useState(false);
  const [zoom, setZoom] = useState<number | null>(null);      // current zoom when the camera supports it
  const [zoomMax, setZoomMax] = useState(1);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const last = useRef<{ code: string; at: number }>({ code: "", at: 0 });   // last ACCEPTED scan
  const seen = useRef<{ code: string; at: number }>({ code: "", at: 0 });   // last DETECTED frame
  const inflight = useRef(false);
  const compact = compactProp || nextItem !== undefined;

  async function setZoomLevel(z: number) {
    const t = trackRef.current; if (!t) return;
    try { await t.applyConstraints({ advanced: [{ zoom: z } as MediaTrackConstraintSet] }); setZoom(z); } catch {}
  }

  useEffect(() => {
    let stopped = false; let stream: MediaStream | null = null; let raf = 0; let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (raw: string) => {
      if (stopped) return;
      const t = raw.trim(); const now = Date.now();
      if (continuous) {
        // Double-scan guard: the same label must LEAVE the frame (no detection for 700 ms) before it counts again,
        // and never within 1.2 s of the last accepted read. A scan already being saved blocks new reads.
        const gap = t === seen.current.code ? now - seen.current.at : Infinity;
        seen.current = { code: t, at: now };
        if (inflight.current) return;
        if (t === last.current.code && (gap < 700 || now - last.current.at < 1200)) return;
        last.current = { code: t, at: now }; inflight.current = true;
        Promise.resolve(onScan(t)).then((ok) => { if (ok === false) { buzz(); setBad(true); setTimeout(() => setBad(false), 500); } else { beep(); setFlash(true); setTimeout(() => setFlash(false), 250); } }).finally(() => { inflight.current = false; });
        return;
      }
      stopped = true; beep(); cleanup(); onScan(t);
    };
    const cleanup = () => { cancelAnimationFrame(raf); if (timer) clearTimeout(timer); if (stream) stream.getTracks().forEach((tr) => tr.stop()); };
    const openCamera = async () => {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      const v = video.current!; v.srcObject = stream; await v.play();
      const track = stream.getVideoTracks()[0]; trackRef.current = track;
      try { await track.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }); } catch {}
      // Zoom in a little by default when the camera allows it – barcodes lock on faster and from further away.
      try {
        const caps = (track.getCapabilities?.() || {}) as { zoom?: { min: number; max: number } };
        if (caps.zoom && caps.zoom.max > 1) { setZoomMax(Math.min(caps.zoom.max, 4)); const z = Math.min(2, caps.zoom.max); await track.applyConstraints({ advanced: [{ zoom: z } as MediaTrackConstraintSet] }); setZoom(z); }
      } catch {}
      return v;
    };
    // Region of the video that sits inside the white box (the video is object-fit: cover inside `frame`).
    const boxRegion = (v: HTMLVideoElement) => {
      const f = frame.current; if (!f || !v.videoWidth) return null;
      const cw = f.clientWidth, ch = f.clientHeight, vw = v.videoWidth, vh = v.videoHeight;
      const scale = Math.max(cw / vw, ch / vh); const dw = vw * scale, dh = vh * scale; const ox = (cw - dw) / 2, oy = (ch - dh) / 2;
      const bx = cw * 0.08, by = ch * 0.32, bw = cw * 0.84, bh = ch * 0.32;
      const sx = Math.max(0, (bx - ox) / scale), sy = Math.max(0, (by - oy) / scale);
      return { sx, sy, sw: Math.min(vw - sx, bw / scale), sh: Math.min(vh - sy, bh / scale) };
    };
    (async () => {
      try {
        if (window.BarcodeDetector) {
          setEngine("native");
          const det = new window.BarcodeDetector({ formats: ["code_128", "code_39", "ean_13", "ean_8", "upc_a", "upc_e", "itf", "codabar", "qr_code"] });
          const v = await openCamera();
          let busy = false;
          const tick = async () => {
            if (stopped) return;
            if (!busy && v.readyState >= 2) {
              busy = true;
              try { const codes = await det.detect(v); if (codes.length && codes[0].rawValue) { finish(codes[0].rawValue); if (!continuous) return; } } catch {}
              busy = false;
            }
            raf = requestAnimationFrame(tick);
          };
          raf = requestAnimationFrame(tick);
        } else {
          // ZXing path (iPhone Safari): decode only the strip inside the white box, upscaled – far quicker to lock on than the full frame.
          setEngine("zxing");
          const { BrowserMultiFormatReader } = await import("@zxing/browser");
          const { BarcodeFormat, DecodeHintType } = await import("@zxing/library");
          const hints = new Map();
          hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.ITF, BarcodeFormat.CODABAR, BarcodeFormat.QR_CODE]);
          hints.set(DecodeHintType.TRY_HARDER, true);
          const reader = new BrowserMultiFormatReader(hints);
          const v = await openCamera();
          const canvas = document.createElement("canvas"); const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
          const loop = () => {
            if (stopped) return;
            try {
              const r = boxRegion(v);
              if (r && r.sw > 50 && r.sh > 20) {
                const W = 1280, H = Math.round((r.sh / r.sw) * W);
                canvas.width = W; canvas.height = H; ctx.drawImage(v, r.sx, r.sy, r.sw, r.sh, 0, 0, W, H);
                try { const res = reader.decodeFromCanvas(canvas); if (res) { finish(res.getText()); if (!continuous) return; } } catch { /* nothing in frame */ }
              }
            } catch {}
            timer = setTimeout(loop, 70);
          };
          timer = setTimeout(loop, 300);
        }
      } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    })();
    return cleanup;
  }, [onScan, continuous]);
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 50, display: "flex", flexDirection: "column" }}>
      <div ref={frame} style={compact ? { position: "relative", height: "34vh", flex: "none", overflow: "hidden" } : { position: "relative", flex: 1, minHeight: 0, overflow: "hidden" }}>
      <video ref={video} style={{ width: "100%", height: "100%", objectFit: "cover" }} muted playsInline autoPlay />
      <div style={{ position: "absolute", left: "8%", right: "8%", top: "32%", height: "32%", border: `3px solid ${bad ? "#ff4d4d" : flash ? "#3ddc84" : "rgba(255,255,255,.85)"}`, borderRadius: 8, pointerEvents: "none", boxShadow: "0 0 0 2000px rgba(0,0,0,.25)", transition: "border-color .1s" }} />
      <div style={{ position: "absolute", top: 10, left: 0, right: 0, textAlign: "center", color: "#fff", fontSize: 13, textShadow: "0 1px 3px #000" }}>{continuous ? (hint || "Scan each item – it beeps when it's in") : "Line the barcode up in the box · hold steady"}</div>
      {zoom !== null && <button type="button" onClick={() => setZoomLevel(zoom >= 2 ? 1 : zoom >= 1.5 ? 2 : Math.min(zoomMax, zoom + 1))} style={{ position: "absolute", right: 10, bottom: 10, padding: "6px 12px", fontSize: 14, background: "rgba(0,0,0,.55)", border: "1px solid rgba(255,255,255,.6)", borderRadius: 999 }}>{zoom >= 1.95 ? "2×" : zoom > 1 ? `${zoom.toFixed(1)}×` : "1×"}</button>}
      {engine === "zxing" && <div style={{ position: "absolute", left: 10, bottom: 14, color: "#ccc", fontSize: 11 }}>hold still · 20–30 cm</div>}
      {err && <div className="err" style={{ position: "absolute", left: 16, right: 16, top: 48 }}>Camera: {err}. Allow camera access for this site, or type the barcode.</div>}
      </div>
      {continuous && (
        <div style={{ background: "#111", color: "#fff", padding: "10px 14px 0", flex: 1, minHeight: 0, overflow: "auto" }}>
          {nextItem !== undefined && (nextItem ? (
            <div style={{ background: "#1d4ed8", borderRadius: 12, padding: "12px 14px", marginBottom: 10, boxShadow: "0 4px 14px rgba(29,78,216,.45)" }}>
              <div style={{ fontSize: 11, color: "#bfdbfe", letterSpacing: ".08em", fontWeight: 700 }}>PICK NEXT</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 2 }}><span style={{ fontSize: 34, fontWeight: 900, letterSpacing: ".02em" }}>{nextItem.bin || "no bin"}</span>{nextItem.qty > 1 && <span style={{ fontSize: 20, fontWeight: 800, background: "#fff", color: "#1d4ed8", borderRadius: 999, padding: "0 10px" }}>×{nextItem.qty}</span>}</div>
              <div style={{ fontSize: 19, fontWeight: 700, lineHeight: 1.2, marginTop: 2 }}>{nextItem.product}</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 2 }}><div style={{ fontSize: 16, color: "#dbeafe" }}>Size {nextItem.size}</div>{onSkip && <button type="button" onClick={onSkip} style={{ background: "rgba(255,255,255,.18)", border: "1px solid rgba(255,255,255,.6)", color: "#fff", padding: "6px 12px", fontSize: 14 }}>Skip →</button>}</div>
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
