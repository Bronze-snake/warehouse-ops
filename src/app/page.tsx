export default function Home() {
  return (
    <>
      <h1>Warehouse</h1>
      <p className="sub">Preston · pick a tile</p>
      <div className="tiles">
        <a className="tile" href="/find"><div className="t">FIND</div><div className="d">Scan a barcode or type a product name – shows the bin.</div></a>
        <a className="tile" href="/putaway"><div className="t">PUT AWAY</div><div className="d">Stock coming back from stores and returns. Scan → list in bin order → receive into Preston.</div></a>
        <a className="tile soon" href="#"><div className="t">PICK LIST</div><div className="d">Daily store replen with scan-to-confirm. Coming next.</div></a>
        <a className="tile" href="/replen"><div className="t">WAREHOUSE REPLEN</div><div className="d">Sold from the warehouse since 3pm yesterday (Mon: since Fri) – pull down from excess, most sold first.</div></a>
      </div>
      <h2>Admin</h2>
      <div className="row"><a className="btn secondary" href="/locations">Location master</a><a className="btn secondary" href="/history">Put-away history</a></div>
    </>
  );
}
