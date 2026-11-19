// Site access: a shared access code (ACCESS_CODE env) plus the person's name, kept in a signed cookie.
// Google sign-in can replace this later without touching the rest of the app.
import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

const COOKIE = "ops_user";
function secret() { return process.env.AUTH_SECRET || process.env.ACCESS_CODE || "dev-secret"; }
function sign(v: string) { return createHmac("sha256", secret()).update(v).digest("base64url"); }

export function makeToken(name: string) { const v = Buffer.from(name).toString("base64url") + "." + Date.now(); return v + "." + sign(v); }
export function verifyToken(t: string | undefined): string | null {
  if (!t) return null;
  const i = t.lastIndexOf("."); if (i < 0) return null;
  const v = t.slice(0, i), s = t.slice(i + 1);
  const exp = sign(v);
  if (exp.length !== s.length || !timingSafeEqual(Buffer.from(exp), Buffer.from(s))) return null;
  const [name, ts] = v.split(".");
  if (Date.now() - Number(ts) > 180 * 864e5) return null; // 180 days
  return Buffer.from(name, "base64url").toString();
}
export async function currentUser(): Promise<string | null> {
  const c = await cookies();
  return verifyToken(c.get(COOKIE)?.value);
}
export const COOKIE_NAME = COOKIE;
export function codeOk(code: string) {
  const want = process.env.ACCESS_CODE || "";
  return !!want && code.length === want.length && timingSafeEqual(Buffer.from(code), Buffer.from(want));
}
