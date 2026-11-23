export default function Home() {
  return (
    <>
      <div className="tiles">
        <a className="tile" href="/find"><div className="t">🔍 FIND</div><div className="d">Scan a barcode or type a product name – shows the bin.</div></a>
        <a className="tile" href="/putaway"><div className="t">📥 PUT AWAY</div><div className="d">Stock coming back from stores and returns. Scan → list in bin order → receive into Preston.</div></a>
        <a className="tile" href="/pick"><div className="t">🛍️ STORE REPLEN</div><div className="d">Pick a store and dates, then scan each item as you pick it. Womens and Mens can be picked separately.</div></a>
        <a className="tile" href="/orders"><div className="t">📬 ORDERS</div><div className="d">Split the morning queue into short-walk print batches (BATCH-01…) for ShipStation. Singles by bin + SKU, multis by aisle.</div></a>
        <a className="tile" href="/replen"><div className="t">📦 WAREHOUSE REPLEN</div><div className="d">Sold from the warehouse since 3pm yesterday (Mon: since Fri) – pull down from excess, most sold first.</div></a>
      </div>
      <h2>Admin</h2>
      <div className="row"><a className="btn secondary" href="/locations">Location master</a><a className="btn secondary" href="/history">Put-away history</a></div>
    </>
  );
}
