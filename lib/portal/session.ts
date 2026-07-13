/**
 * Customer portal sessions.
 *
 * Passwordless: customers request a magic link by email; clicking it sets
 * an httpOnly session cookie. The session is a signed HMAC token (same
 * primitive as lib/auth/signedTokens) keyed by EMAIL, not contact id -
 * one customer may have contact rows at both shops and the portal
 * aggregates them.
 */

import { createHash, createHmac, randomBytes } from "crypto";
import { cookies } from "next/headers";

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const PORTAL_COOKIE = "ccc_portal";
const SESSION_DAYS = 60;
const LINK_EXPIRY_MINUTES = 20;

function getSecret(): string {
  const v = process.env.PORTAL_SESSION_SECRET || process.env.ACTION_TOKEN_SECRET;
  if (!v) throw new Error("Missing PORTAL_SESSION_SECRET / ACTION_TOKEN_SECRET");
  return v;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4;
  const padded = pad ? s + "=".repeat(4 - pad) : s;
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

// ── Session cookie ─────────────────────────────────────────────────────

type SessionPayload = { email: string; e: number };

export function signSession(email: string): string {
  const payload: SessionPayload = {
    email: email.toLowerCase().trim(),
    e: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000,
  };
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = createHmac("sha256", getSecret()).update(`portal:${body}`).digest("hex").slice(0, 32);
  return `${body}.${sig}`;
}

export function verifySession(token: string): { email: string } | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = createHmac("sha256", getSecret()).update(`portal:${body}`).digest("hex").slice(0, 32);
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(b64urlDecode(body).toString("utf8")) as SessionPayload;
    if (typeof payload.e !== "number" || Date.now() > payload.e) return null;
    if (!payload.email) return null;
    return { email: payload.email };
  } catch {
    return null;
  }
}

/** Read + verify the portal session from the request cookies. */
export async function getPortalSession(): Promise<{ email: string } | null> {
  const store = await cookies();
  const raw = store.get(PORTAL_COOKIE)?.value;
  if (!raw) return null;
  return verifySession(raw);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  };
}

// ── Magic-link tokens ──────────────────────────────────────────────────

export function hashLoginToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Mint a one-time login token for an email. Only the sha256 lands in the
 * DB; the raw token goes into the emailed link.
 */
export async function createLoginToken(email: string): Promise<string> {
  const supabase = getSupabaseAdminClient();
  const raw = b64url(randomBytes(32));
  const { error } = await supabase.from("portal_login_tokens").insert({
    email: email.toLowerCase().trim(),
    token_hash: hashLoginToken(raw),
    expires_at: new Date(Date.now() + LINK_EXPIRY_MINUTES * 60 * 1000).toISOString(),
  });
  if (error) throw error;
  return raw;
}

/**
 * Validate + consume a magic-link token. Single-use: marks used_at on
 * success. Returns the email it was minted for.
 */
export async function consumeLoginToken(raw: string): Promise<string | null> {
  const supabase = getSupabaseAdminClient();
  const hash = hashLoginToken(raw);
  const { data } = await supabase
    .from("portal_login_tokens")
    .select("id, email, expires_at, used_at")
    .eq("token_hash", hash)
    .maybeSingle();
  if (!data) return null;
  if (data.used_at) return null;
  if (new Date(data.expires_at).getTime() < Date.now()) return null;
  await supabase
    .from("portal_login_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("id", data.id);
  return data.email;
}

// ── Portal identity helpers ────────────────────────────────────────────

export type PortalContact = {
  id: string;
  shop_id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
};

/** All contact rows (across shops) belonging to the session email. */
export async function getPortalContacts(email: string): Promise<PortalContact[]> {
  const supabase = getSupabaseAdminClient();
  const { data } = await supabase
    .from("contacts")
    .select("id, shop_id, first_name, last_name, full_name, email, phone")
    .ilike("email", email);
  return (data ?? []) as PortalContact[];
}
