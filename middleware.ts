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
  "/api/booking-series/intake",
  "/api/quote-events",               // instant-quote funnel beacons (sendBeacon, no session)
  "/api/funnel-events",              // booking-funnel drop-off beacons (sendBeacon, no session)
  "/api/vehicle-size",               // public vehicle sizing for the ceramic ad funnel
  "/api/email-events/",
  "/api/emails/process-reminders",   // Vercel cron 8am UTC daily
  "/api/emails/process-scheduled",   // pg_cron every minute
  "/api/emails/daily-digest",        // Vercel cron 7pm UTC = 7am NZ daily
  "/api/emails/weekly-conversion",   // Vercel cron Sun 8pm UTC = Mon 8am NZ weekly
  "/api/integrations/google-ads-conversions", // Vercel cron 2pm UTC = 2am NZ daily
  "/api/emails/daily-approval-pending", // Vercel cron 11pm UTC = 11am NZ daily
  "/api/cron/regenerate-series",     // Vercel cron 5pm UTC = 5am NZ daily
  "/api/cron/health-alert",          // Vercel cron 8pm UTC = 8am NZ daily
  "/api/cron/warm-availability",     // GitHub Actions cron */10 NZ hours (Vercel rejects sub-daily); Bearer CRON_SECRET in handler
  "/api/admin/pending-enquiries-report", // on-demand, authed by CRON_SECRET in handler
  "/lead-action/",                   // public confirmation pages after token-authed actions
  "/manage-booking",                 // customer self-service reschedule/cancel page
  "/lock-in-recurring",              // customer-facing post-detail lock-in page
  "/account",                        // customer portal (self-authed via portal session cookie)
  "/api/portal/",                    // portal APIs (self-authed via portal session cookie)
  "/api/cron/portal-reminders",      // Vercel cron 9pm UTC = 9am NZ daily
  "/api/stripe/webhook",             // signature-authed in handler
  "/r/",                             // short URL redirector (SMS touchpoints)
  "/api/public/",                    // token-authed customer-facing actions
  "/_next/",
  "/favicon",
];

// Paths that are themselves authenticated by signed token (not session)
// — middleware lets the request through, the route handler verifies the token.
const TOKEN_AUTHED_PATTERNS = [
  /^\/api\/leads\/[^/]+\/quick-send/,
];

// Customer-facing pages: even if a staff user happens to be logged in,
// these should render WITHOUT the staff nav (which overflows mobile and
// looks wrong on a customer-facing screen). The layout reads this flag.
const CUSTOMER_PAGE_PREFIXES = [
  "/lead-action/",
  "/manage-booking",
  "/lock-in-recurring",
  "/account",
];

function makeNext(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const isCustomerPage = CUSTOMER_PAGE_PREFIXES.some((p) => pathname.startsWith(p));
  // We always forward the current pathname as a request header so server
  // components (e.g. the root layout) can role-gate without re-parsing the
  // URL. Only the layout uses this today — see lib/auth/roles.ts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", pathname);
  if (isCustomerPage) {
    requestHeaders.set("x-customer-page", "1");
  }
  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return makeNext(request);
  }

  if (TOKEN_AUTHED_PATTERNS.some((re) => re.test(pathname))) {
    return makeNext(request);
  }

  const sessionId = request.cookies.get(SESSION_COOKIE)?.value;

  if (!sessionId) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Role-based route gating (sales users restricted to /sales + lead detail)
  // is enforced in the root layout for pages and in individual API route
  // handlers for endpoints. We deliberately don't run a Supabase round-trip
  // in middleware on every request — see lib/auth/roles.ts gateRouteForRole.

  return makeNext(request);
}

export const config = {
  // Static assets (Next-compiled and our own /images/ folder) skip middleware
  // entirely — they're public files and shouldn't be auth-gated. Email clients
  // fetching map images, etc. would otherwise be redirected to /login.
  matcher: ["/((?!_next/static|_next/image|images/|favicon.ico).*)"],
};
