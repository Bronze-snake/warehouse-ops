"use client";
import { useEffect, useRef, useState } from "react";

// Phone-camera barcode scanner. Native BarcodeDetector when the browser has one (fast), ZXing otherwise.
// Calls onScan(code) once per read, then stops.
type Detector = { detect: (src: ImageBitmapSource) => Promise<{ rawValue: string }[]> };
declare global { interface Window { BarcodeDetector?: new (o?: { formats?: string[] }) => Detector & { constructor: { getSupportedFormats?: () => Promise<string[]> } } } }

export default function CameraScan({ onScan, onClose }: { onScan: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [engine, setEngine] = useState("");
  useEffect(() => {
    let stopped = false; let stream: MediaStream | null = null; let zx: { stop: () => void } | null = null; let raf = 0;
    const finish = (t: string) => { if (stopped) return; stopped = true; try { navigator.vibrate?.(80); } catch {} cleanup(); onScan(t.trim()); };
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
  }, [onScan]);
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 50, display: "flex", flexDirection: "column" }}>
      <video ref={video} style={{ flex: 1, width: "100%", objectFit: "cover" }} muted playsInline autoPlay />
      <div style={{ position: "absolute", left: "8%", right: "8%", top: "42%", height: "16%", border: "2px solid rgba(255,255,255,.85)", borderRadius: 8, pointerEvents: "none", boxShadow: "0 0 0 2000px rgba(0,0,0,.25)" }} />
      <div style={{ position: "absolute", top: 14, left: 0, right: 0, textAlign: "center", color: "#fff", fontSize: 14, textShadow: "0 1px 3px #000" }}>Line the barcode up in the box · hold steady {engine === "zxing" ? "· 1–2 s" : ""}</div>
      {err && <div className="err" style={{ position: "absolute", left: 16, right: 16, top: 48 }}>Camera: {err}. Allow camera access for this site, or type the barcode.</div>}
      <div style={{ padding: 16, textAlign: "center" }}><button className="secondary" type="button" onClick={onClose}>Cancel</button></div>
    </div>
  );
}
