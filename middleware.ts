import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { SESSION_COOKIE } from "@/lib/auth/session";

// Paths that don't require authentication.
// Cron endpoints authenticate via Bearer <CRON_SECRET> in their handlers.
const PUBLIC_PREFIXES = [
  "/login",
  "/api/auth/",
  "/api/leads/intake",
  "/api/bookings/intake",
  "/api/email-events/",
  "/api/emails/process-reminders",   // Vercel cron 8am UTC daily
  "/api/emails/process-scheduled",   // pg_cron every minute
  "/api/sms/process-review",         // Vercel cron 9am UTC daily
  "/_next/",
  "/favicon",
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const sessionId = request.cookies.get(SESSION_COOKIE)?.value;

  if (!sessionId) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
