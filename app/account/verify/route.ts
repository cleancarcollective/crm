/**
 * GET /account/verify?token=... - magic-link landing. Consumes the
 * one-time token, sets the portal session cookie, redirects to /account.
 */

import { NextRequest, NextResponse } from "next/server";

import { consumeLoginToken, PORTAL_COOKIE, sessionCookieOptions, signSession } from "@/lib/portal/session";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const base = req.nextUrl.origin;

  if (!token) {
    return NextResponse.redirect(`${base}/account/login?error=missing`);
  }

  const email = await consumeLoginToken(token);
  if (!email) {
    return NextResponse.redirect(`${base}/account/login?error=expired`);
  }

  const res = NextResponse.redirect(`${base}/account`);
  res.cookies.set(PORTAL_COOKIE, signSession(email), sessionCookieOptions());
  return res;
}
