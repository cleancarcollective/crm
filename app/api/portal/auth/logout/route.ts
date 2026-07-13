import { NextRequest, NextResponse } from "next/server";

import { PORTAL_COOKIE } from "@/lib/portal/session";

export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(`${req.nextUrl.origin}/account/login`, 303);
  res.cookies.set(PORTAL_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
