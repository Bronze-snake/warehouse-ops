import { locationMasterInfo, fmt } from "@/lib/putaway";
export const dynamic = "force-dynamic";
export default async function Locations({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  const sp = await searchParams; const lm = await locationMasterInfo();
  return (
    <>
      <h1>Location master</h1>
      <p className="sub">Sean&apos;s ShipStation export (SKU + WarehouseLocation). Upload the newest file; it replaces the previous one.</p>
      {sp.ok && <div className="ok">Loaded {Number(sp.ok).toLocaleString()} SKU locations.</div>}
      <div className="card">
        <p className="meta">{lm.count ? `${lm.count.toLocaleString()} SKUs · uploaded ${fmt(lm.uploadedAt)} · ${lm.file}` : "Nothing loaded yet."}</p>
        <form method="post" action="/api/locations/upload" encType="multipart/form-data">
          <label>ShipStation CSV</label><input type="file" name="file" accept=".csv,text/csv" required />
          <div style={{ marginTop: 12 }}><button type="submit">Upload</button> <a className="btn secondary" href="/">Back</a></div>
        </form>
      </div>
    </>
  );
}
