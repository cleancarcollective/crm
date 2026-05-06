/**
 * Signed action tokens for one-click links in transactional emails.
 *
 * Use case: an approval email contains a "Send as-is" button. We want one
 * click to be enough — no login required. But the link travels publicly
 * (via the recipient's email client, possibly an email scanner that
 * pre-fetches links, etc.) so it MUST be:
 *   - Signed (only we could have produced it)
 *   - Scoped (action + resource ID + shop)
 *   - Time-limited (expires)
 *   - Single-use (we record consumption to prevent replay — see consumed_action_tokens)
 *
 * Format (URL-safe base64): {payload}.{hmac}
 *   payload (base64url JSON): { a: action, r: resourceId, s: shopId, e: expiresAt }
 *   hmac: HMAC-SHA256(payload, ACTION_TOKEN_SECRET) → first 16 bytes hex
 *
 * 16-byte HMAC is enough for this use case (one-shot tokens that expire
 * within hours and can't be brute-forced over the wire). Cheap to verify.
 *
 * To prevent replay, callers should record successful uses in the
 * consumed_action_tokens table (see below) — keyed by the full token string.
 */

import { createHmac } from "crypto";

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

const SECRET_ENV = "ACTION_TOKEN_SECRET";

function getSecret(): string {
  const v = process.env[SECRET_ENV];
  if (!v) throw new Error(`Missing required env var: ${SECRET_ENV}`);
  return v;
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4;
  const padded = pad ? s + "=".repeat(4 - pad) : s;
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export type ActionTokenPayload = {
  /** Action identifier — the route that will accept this token */
  a: string;
  /** Resource ID this token authorises (lead_id, booking_id, etc.) */
  r: string;
  /** Shop scoping — defends against cross-shop replay */
  s: string;
  /** Expires-at, ms since epoch */
  e: number;
};

/**
 * Sign an action token. Default expiry is 7 days — long enough that the
 * recipient has time to act, short enough that an old leaked link
 * eventually stops working.
 */
export function signActionToken(payload: Omit<ActionTokenPayload, "e">, expiresInSeconds = 7 * 24 * 60 * 60): string {
  const fullPayload: ActionTokenPayload = {
    ...payload,
    e: Date.now() + expiresInSeconds * 1000,
  };
  const payloadJson = JSON.stringify(fullPayload);
  const payloadB64 = b64urlEncode(Buffer.from(payloadJson, "utf8"));
  const sig = createHmac("sha256", getSecret()).update(payloadB64).digest("hex").slice(0, 32);
  return `${payloadB64}.${sig}`;
}

export type VerifyResult =
  | { ok: true; payload: ActionTokenPayload; token: string }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "consumed" };

/**
 * Verify an action token's signature, expiry, and (optionally) single-use status.
 * Pass `requireAction` to additionally check the action matches what this
 * route handler is expecting.
 */
export async function verifyActionToken(
  token: string,
  options: { requireAction?: string; checkConsumed?: boolean } = {}
): Promise<VerifyResult> {
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  const [payloadB64, sig] = parts;

  const expectedSig = createHmac("sha256", getSecret()).update(payloadB64).digest("hex").slice(0, 32);
  if (sig !== expectedSig) return { ok: false, reason: "bad_signature" };

  let payload: ActionTokenPayload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (typeof payload.e !== "number" || Date.now() > payload.e) {
    return { ok: false, reason: "expired" };
  }

  if (options.requireAction && payload.a !== options.requireAction) {
    return { ok: false, reason: "malformed" };
  }

  if (options.checkConsumed) {
    const supabase = getSupabaseAdminClient();
    const { data } = await supabase
      .from("consumed_action_tokens")
      .select("token")
      .eq("token", token)
      .maybeSingle();
    if (data) return { ok: false, reason: "consumed" };
  }

  return { ok: true, payload, token };
}

/**
 * Mark a token as consumed so the same link can't be replayed.
 * Caller should invoke this AFTER successfully completing the action.
 */
export async function consumeActionToken(token: string, payload: ActionTokenPayload) {
  const supabase = getSupabaseAdminClient();
  await supabase.from("consumed_action_tokens").insert({
    token,
    action: payload.a,
    resource_id: payload.r,
    shop_id: payload.s,
    expires_at: new Date(payload.e).toISOString(),
  });
}
