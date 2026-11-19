export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="card" style={{ maxWidth: 420, margin: "40px auto" }}>
      <h1>Sign in</h1>
      <p className="sub">Enter the warehouse access code.</p>
      {sp.error && <div className="err">Wrong access code.</div>}
      <form method="post" action="/api/login">
        <input type="hidden" name="next" value={sp.next || "/"} />
        <label>Access code</label><input type="password" name="code" required autoFocus inputMode="numeric" style={{ fontSize: 22 }} />
        <div style={{ marginTop: 14 }}><button type="submit">Sign in</button></div>
      </form>
    </div>
  );
}
