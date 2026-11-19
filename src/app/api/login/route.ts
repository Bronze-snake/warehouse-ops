import { NextResponse } from "next/server";
import { codeOk, makeToken, COOKIE_NAME } from "@/lib/auth";
export async function POST(req: Request) {
  const form = await req.formData();
  const code = String(form.get("code") || ""), name = String(form.get("name") || "").trim().slice(0, 40), next = String(form.get("next") || "/");
  if (!name || !codeOk(code)) return NextResponse.redirect(new URL("/login?error=1&next=" + encodeURIComponent(next), req.url), 303);
  const res = NextResponse.redirect(new URL(next.startsWith("/") ? next : "/", req.url), 303);
  res.cookies.set(COOKIE_NAME, makeToken(name), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 180 * 86400 });
  return res;
}
