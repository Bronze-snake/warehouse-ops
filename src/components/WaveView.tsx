"use client";
import PickView, { type PickConfig } from "./PickView";
const WAVE_CONFIG: PickConfig = { api: "/api/wave", backHref: "/orders", backLabel: "Orders", title: (r) => r.store, subtitle: (r) => r.label, tabs: ["Singles", "Multis"], rebuild: false, manifest: false, finishNote: "Finish this wave? It just locks the list – labels and Scan & Verify stay in ShipStation.", scanHint: "scan each item into the tote" };
export default function WaveView({ id }: { id: number }) { return <PickView id={id} cfg={WAVE_CONFIG} />; }
