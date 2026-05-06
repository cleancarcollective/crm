/**
 * Single source of truth for "which shop is the current request operating on?"
 *
 * Every server-side query that touches shop-scoped data (leads, contacts,
 * bookings, pricing, templates, settings, etc.) MUST resolve the current
 * shop via this helper. Hardcoded shop slugs / IDs in pages or routes are
 * a multi-tenant data leak waiting to happen.
 *
 * The shop is resolved from the session cookie:
 *   1. Read SESSION_COOKIE
 *   2. verifySession() → SessionUser (which includes the user's shop)
 *   3. Return shop or null
 *
 * Pages that fail to find a session should redirect to /login (the auth
 * middleware already handles this for most paths). API routes should
 * return 401.
 */

import { cookies } from "next/headers";

import { SESSION_COOKIE, type SessionShop, type SessionUser, verifySession } from "./session";

export type { SessionShop, SessionUser };

/**
 * Get the authenticated user (with their shop) for the current request.
 * Returns null if no valid session.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;
  return verifySession(sessionId);
}

/**
 * Get the current shop (the shop the logged-in user belongs to).
 * Returns null if no valid session.
 */
export async function getCurrentShop(): Promise<SessionShop | null> {
  const user = await getCurrentUser();
  return user?.shop ?? null;
}

/**
 * Like getCurrentShop, but throws if no session — for use in places
 * where missing auth is genuinely an error state (the middleware should
 * have caught it already).
 */
export async function requireCurrentShop(): Promise<SessionShop> {
  const shop = await getCurrentShop();
  if (!shop) {
    throw new Error("No authenticated session — middleware should have redirected");
  }
  return shop;
}
