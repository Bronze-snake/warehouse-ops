// Database access. Production: Neon Postgres via DATABASE_URL. Local/dev without DATABASE_URL: PGlite (in-process Postgres).
// One function: q(sql, params) -> rows. Schema is created on first use.

type Row = Record<string, unknown>;
type Runner = (sql: string, params?: unknown[]) => Promise<Row[]>;

let runner: Runner | null = null;
let ready: Promise<void> | null = null;

async function getRunner(): Promise<Runner> {
  if (runner) return runner;
  const url = process.env.DATABASE_URL;
  if (url) {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(url);
    runner = async (text, params = []) => (await sql.query(text, params as never[])) as Row[];
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    const g = globalThis as unknown as { __pglite?: InstanceType<typeof PGlite> };
    if (!g.__pglite) g.__pglite = new PGlite(process.env.PGLITE_DIR || undefined) /* no DATABASE_URL: in-memory Postgres for local testing */;
    const db = g.__pglite;
    runner = async (text, params = []) => (await db.query(text, params as never[])).rows as Row[];
  }
  return runner;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS variants (
  barcode text PRIMARY KEY,
  variant_id text NOT NULL,
  inventory_item_id text NOT NULL,
  sku text NOT NULL DEFAULT '',
  product text NOT NULL,
  size text NOT NULL DEFAULT '',
  colour text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS bins (
  sku text PRIMARY KEY,
  bin text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS putaway_batches (
  id serial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT '',
  fingerprint text NOT NULL,
  lines integer NOT NULL,
  units integer NOT NULL,
  unknown_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'built',
  received_at timestamptz,
  received_by text,
  shopify_ref text,
  error text
);
CREATE TABLE IF NOT EXISTS putaway_lines (
  id serial PRIMARY KEY,
  batch_id integer NOT NULL REFERENCES putaway_batches(id) ON DELETE CASCADE,
  barcode text NOT NULL,
  qty integer NOT NULL,
  variant_id text,
  inventory_item_id text,
  sku text,
  product text,
  size text,
  colour text,
  bin text,
  status text NOT NULL DEFAULT 'ok'
);
CREATE INDEX IF NOT EXISTS putaway_lines_batch ON putaway_lines(batch_id);
CREATE INDEX IF NOT EXISTS putaway_batches_fp ON putaway_batches(fingerprint, created_at);
ALTER TABLE bins ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT '';
`;

export async function q<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  const run = await getRunner();
  if (!ready) {
    ready = (async () => {
      for (const stmt of SCHEMA.split(";").map((s) => s.trim()).filter(Boolean)) await run(stmt);
    })();
  }
  await ready;
  return (await run(sql, params)) as T[];
}

export async function getSetting(key: string): Promise<string | null> {
  const r = await q<{ value: string }>("SELECT value FROM settings WHERE key=$1", [key]);
  return r[0]?.value ?? null;
}
export async function setSetting(key: string, value: string) {
  await q("INSERT INTO settings(key,value,updated_at) VALUES($1,$2,now()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()", [key, value]);
}
