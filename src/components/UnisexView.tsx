"use client";
import PickView, { type PickConfig } from "./PickView";
const UNISEX_CONFIG: PickConfig = {
  api: "/api/unisex", backHref: "/unisex", backLabel: "Unisex", title: () => "Unisex transfer", subtitle: (r) => r.label, tabs: ["Mens → Unisex", "Unisex → Mens"],
  rebuild: false, manifest: false, gun: true, nameRequired: true, finishLabel: "ADJUST COUNTS",
  finishNote: "Adjust the Shopify counts now? Everything picked since the last adjustment moves from the garment's current listing to its twin – Preston only, total stock unchanged. Logged as a UNISEX-TRANSFER with your name. You can keep picking and adjust again later.",
  scanHint: "scan the garment's CURRENT barcode as you pick it", extraLinks: [{ label: "Labels CSV (printer)", href: (id) => `/api/unisex/${id}/labels` }],
  removedTitle: "Checked but left alone",
};
export default function UnisexView({ id }: { id: number }) { return <PickView id={id} cfg={UNISEX_CONFIG} />; }
