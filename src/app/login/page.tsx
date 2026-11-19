export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="card" style={{ maxWidth: 420, margin: "40px auto" }}>
      <h1>Sign in</h1>
      <p className="sub">Your name goes on what you receive.</p>
      {sp.error && <div className="err">Wrong access code, or no name.</div>}
      <form method="post" action="/api/login">
        <input type="hidden" name="next" value={sp.next || "/"} />
        <label>Your name</label><input type="text" name="name" required autoComplete="given-name" />
        <label>Access code</label><input type="password" name="code" required />
        <div style={{ marginTop: 14 }}><button type="submit">Sign in</button></div>
      </form>
    </div>
  );
}
