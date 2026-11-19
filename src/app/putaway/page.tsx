import { locationMasterInfo, fmt } from "@/lib/putaway";
import { shopifyConfigured } from "@/lib/shopify";
import ScanForm from "@/components/ScanForm";

export const dynamic = "force-dynamic";
export default async function Putaway() {
  const lm = await locationMasterInfo();
  return (
    <>
      <h1>Put away</h1>
      <p className="sub">Upload the scan (Barcode, Quantity) or scan straight in. The list comes back in bin order.</p>
      {!shopifyConfigured() && <div className="warn">Shopify isn&apos;t connected on this server yet – lists will build from cached barcodes only and nothing can be received.</div>}
      {!lm.count && <div className="warn">No location master loaded yet – everything will show as No location. <a href="/locations">Upload Sean&apos;s ShipStation CSV</a>.</div>}
      {lm.count > 0 && <p className="meta">Location master: {lm.count.toLocaleString()} SKUs, uploaded {fmt(lm.uploadedAt)} ({lm.file}). <a href="/locations">Update</a></p>}
      <ScanForm />
      <p className="meta"><a href="/history">Previous batches</a></p>
    </>
  );
}
