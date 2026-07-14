/**
 * GET /account/verify?token=...&next=/account/... - magic-link landing.
 * Consumes the one-time token, sets the portal session cookie, and
 * redirects to `next` (a safe same-site path) or /account.
 */

import { NextRequest, NextResponse } from "next/server";

import { consumeLoginToken, PORTAL_COOKIE, sessionCookieOptions, signSession } from "@/lib/portal/session";

/** Only allow same-site absolute paths under /account to prevent open redirects. */
function safeNext(raw: string | null): string {
  if (!raw) return "/account";
  if (!raw.startsWith("/account")) return "/account";
  // Reject protocol-relative (//evil.com) and any scheme.
  if (raw.startsWith("//") || raw.includes(":")) return "/account";
  return raw;
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const next = safeNext(req.nextUrl.searchParams.get("next"));
  const base = req.nextUrl.origin;

  if (!token) {
    return NextResponse.redirect(`${base}/account/login?error=missing`);
  }

  const email = await consumeLoginToken(token);
  if (!email) {
    return NextResponse.redirect(`${base}/account/login?error=expired`);
  }

  const res = NextResponse.redirect(`${base}${next}`);
  res.cookies.set(PORTAL_COOKIE, signSession(email), sessionCookieOptions());
  return res;
}
