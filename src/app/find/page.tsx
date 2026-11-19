import Finder from "@/components/Finder";
export const dynamic = "force-dynamic";
export default function Find() {
  return (
    <>
      <h1>Find a location</h1>
      <p className="sub">Scan a barcode, or type a SKU or a few words of the product name.</p>
      <Finder />
    </>
  );
}
