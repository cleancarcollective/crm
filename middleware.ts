import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { SESSION_COOKIE } from "@/lib/auth/session";

// Paths that don't require authentication.
// Cron endpoints authenticate via Bearer <CRON_SECRET> in their handlers.
// Token-authed action endpoints (lead quick-send, future booking-action)
// authenticate via signed URL tokens.
const PUBLIC_PREFIXES = [
  "/login",
  "/api/auth/",
  "/api/leads/intake",
  "/api/bookings/intake",
  "/api/email-events/",
  "/api/emails/process-reminders",   // Vercel cron 8am UTC daily
  "/api/emails/process-scheduled",   // pg_cron every minute
  "/api/emails/daily-digest",        // Vercel cron 7pm UTC = 7am NZ daily
  "/api/emails/weekly-conversion",   // Vercel cron Sun 8pm UTC = Mon 8am NZ weekly
  "/api/integrations/google-ads-conversions", // Vercel cron 2pm UTC = 2am NZ daily
  "/api/emails/daily-approval-pending", // Vercel cron 11pm UTC = 11am NZ daily
  "/api/cron/regenerate-series",     // Vercel cron 5pm UTC = 5am NZ daily
  "/api/admin/pending-enquiries-report", // on-demand, authed by CRON_SECRET in handler
  "/lead-action/",                   // public confirmation pages after token-authed actions
  "/manage-booking",                 // customer self-service reschedule/cancel page
  "/api/public/",                    // token-authed customer-facing actions
  "/_next/",
  "/favicon",
];

// Paths that are themselves authenticated by signed token (not session)
// — middleware lets the request through, the route handler verifies the token.
const TOKEN_AUTHED_PATTERNS = [
  /^\/api\/leads\/[^/]+\/quick-send/,
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  if (TOKEN_AUTHED_PATTERNS.some((re) => re.test(pathname))) {
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
  // Static assets (Next-compiled and our own /images/ folder) skip middleware
  // entirely — they're public files and shouldn't be auth-gated. Email clients
  // fetching map images, etc. would otherwise be redirected to /login.
  matcher: ["/((?!_next/static|_next/image|images/|favicon.ico).*)"],
};
