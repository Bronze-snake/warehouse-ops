"use client";
import { useEffect, useRef, useState } from "react";

// Phone-camera barcode scanner. Calls onScan(code) once per read, then closes.
export default function CameraScan({ onScan, onClose }: { onScan: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let stop: (() => void) | null = null; let done = false;
    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 150 });
        const controls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } }, video.current!, (result) => {
          if (result && !done) { done = true; const t = result.getText().trim(); try { navigator.vibrate?.(60); } catch {} controls.stop(); onScan(t); }
        });
        stop = () => controls.stop();
      } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    })();
    return () => { if (stop) stop(); };
  }, [onScan]);
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 50, display: "flex", flexDirection: "column" }}>
      <video ref={video} style={{ flex: 1, width: "100%", objectFit: "cover" }} muted playsInline />
      <div style={{ position: "absolute", left: "10%", right: "10%", top: "40%", height: "20%", border: "2px solid rgba(255,255,255,.8)", borderRadius: 8, pointerEvents: "none" }} />
      {err && <div className="err" style={{ position: "absolute", left: 16, right: 16, top: 16 }}>Camera: {err}. Allow camera access for this site, or type the barcode.</div>}
      <div style={{ padding: 16, textAlign: "center" }}><button className="secondary" type="button" onClick={onClose}>Cancel</button></div>
    </div>
  );
}
