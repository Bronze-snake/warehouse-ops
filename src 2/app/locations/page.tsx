import { locationMasterInfo, fmt } from "@/lib/putaway";
import LocationUpload from "@/components/LocationUpload";
export const dynamic = "force-dynamic";
export default async function Locations() {
  const lm = await locationMasterInfo();
  return (
    <>
      <h1>Location master</h1>
      <p className="sub">Sean&apos;s ShipStation export (SKU + WarehouseLocation). Upload the newest file; it replaces the previous one.</p>
      <div className="card">
        <p className="meta">{lm.count ? `${lm.count.toLocaleString()} SKUs · uploaded ${fmt(lm.uploadedAt)} · ${lm.file}` : "Nothing loaded yet."}</p>
        <LocationUpload />
      </div>
    </>
  );
}
