/**
 * Role gating helpers.
 *
 * The session resolver in lib/auth/session.ts attaches a `role` of
 * "admin" | "contractor" | "sales" to every authenticated user. This module
 * centralises the rules for what each role can see and do, so individual
 * pages and API routes don't drift out of sync.
 *
 * Path-level gating is enforced in three places:
 *   1. middleware.ts — quick redirect for sales users hitting denied paths
 *   2. server pages / layouts — render or redirect based on role
 *   3. API route handlers — last-line defence; never trust UI hiding alone
 */

import { redirect } from "next/navigation";

import type { SessionUser, StaffRole } from "./session";

export type { StaffRole };

// ── Role checks ──────────────────────────────────────────────────────────

export function isAdminRole(user: { role: StaffRole } | null | undefined): boolean {
  return user?.role === "admin";
}

export function isContractorRole(user: { role: StaffRole } | null | undefined): boolean {
  return user?.role === "contractor";
}

export function isSalesRole(user: { role: StaffRole } | null | undefined): boolean {
  return user?.role === "sales";
}

// ── Path gating ──────────────────────────────────────────────────────────

/**
 * Paths a sales user is allowed to visit. Everything else redirects to
 * /sales. Keep this short — adding to it is a permissions decision.
 *
 * Note: a path prefix match is enough; the API routes themselves still
 * enforce write-permission rules.
 */
const SALES_ALLOWED_PREFIXES: ReadonlyArray<string> = [
  "/sales",
  "/contacts", // contacts list + detail (lead history lives on the contact profile)
  "/clients", // client directory + detail
  "/leads", // leads list page (general view)
  "/bookings", // bookings list + detail (read + edit own bookings)
  "/day", // single-day calendar view
  "/login",
  "/logout",
  "/api/auth/",
  "/api/leads/", // lead notes/status updates
  "/api/contacts/", // contact reads + writes (writes still server-checked)
  "/api/clients/",
  "/api/bookings/", // booking create + edit (api-level checks still apply)
  "/api/booking-series", // create new series; per-id staff edits still gated
  "/api/calendar/",
  "/api/sales-resources", // GET list (writes admin/sales gated server-side)
  "/api/service-offerings", // GET list (writes admin-only server-side)
  "/api/public/", // public availability used by the booking modal
  "/_next/",
  "/favicon",
  "/images/",
  "/icons/",
];

/**
 * Paths explicitly denied to sales (admin-only). Listed here so we still
 * redirect them away cleanly even though the prefixes above are broad.
 */
const SALES_DENIED_PREFIXES: ReadonlyArray<string> = [
  "/settings",
  "/analytics",
  "/sales/stats", // sales rep cannot see their own attribution stats
];

const SALES_DENIED_EXACT: ReadonlyArray<string> = [];

/**
 * Returns a redirect URL if `user` shouldn't be on `pathname`, else null.
 * Currently only sales users are restricted; admin and contractor flows
 * are untouched (contractor gating lives in the layout / individual
 * pages as before).
 */
export function gateRouteForRole(
  user: SessionUser | null,
  pathname: string
): string | null {
  if (!user) return null;
  if (user.role !== "sales") return null;

  if (SALES_DENIED_EXACT.includes(pathname)) {
    return "/sales";
  }

  // Root path (calendar) is allowed.
  if (pathname === "/") return null;

  // Explicit deny wins over the allow list - e.g. /sales/stats sits under
  // /sales (allowed) but should still redirect.
  const denied = SALES_DENIED_PREFIXES.some((p) =>
    pathname === p || pathname.startsWith(`${p}/`)
  );
  if (denied) return "/sales";

  const allowed = SALES_ALLOWED_PREFIXES.some((p) =>
    p.endsWith("/") ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`)
  );
  if (allowed) return null;

  return "/sales";
}

// ── Require helpers (for use in server components / API routes) ──────────

/**
 * Redirect to /login if no user, or to /sales if the user's role isn't in
 * `allowed`. Returns the user on success. Server-component / page use only.
 */
export function requireRoleIn(
  user: SessionUser | null,
  allowed: ReadonlyArray<StaffRole>
): SessionUser {
  if (!user) redirect("/login");
  if (!allowed.includes(user.role)) {
    redirect(user.role === "sales" ? "/sales" : "/");
  }
  return user;
}
