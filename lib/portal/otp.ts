/**
 * 6-digit checkout codes (Shop Pay pattern) minted from the same
 * portal_login_tokens table as magic links, with purpose='checkout_code'.
 *
 * Codes are hashed at rest (sha256 of `otp:{email}:{code}`), expire in
 * 10 minutes, allow 5 verify attempts, and are single-use.
 */

import { createHash, randomInt } from "crypto";

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

const CODE_EXPIRY_MINUTES = 10;
const MAX_ATTEMPTS = 5;

function hashCode(email: string, code: string): string {
  return createHash("sha256").update(`otp:${email.toLowerCase().trim()}:${code}`).digest("hex");
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const head = local.slice(0, 1);
  return `${head}•••@${domain}`;
}

/** Outstanding unexpired codes for an email (rate limiting). */
export async function activeCodeCount(email: string): Promise<number> {
  const supabase = getSupabaseAdminClient();
  const { count } = await supabase
    .from("portal_login_tokens")
    .select("id", { count: "exact", head: true })
    .eq("email", email.toLowerCase().trim())
    .eq("purpose", "checkout_code")
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString());
  return count ?? 0;
}

export async function createCheckoutCode(email: string): Promise<string> {
  const supabase = getSupabaseAdminClient();
  const normalized = email.toLowerCase().trim();
  const code = String(randomInt(0, 1000000)).padStart(6, "0");
  const { error } = await supabase.from("portal_login_tokens").insert({
    email: normalized,
    token_hash: hashCode(normalized, code),
    purpose: "checkout_code",
    expires_at: new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000).toISOString(),
  });
  if (error) throw error;
  return code;
}

export type VerifyCodeResult = "ok" | "invalid" | "expired" | "too_many_attempts";

/**
 * Verify a checkout code. Wrong guesses increment attempts on every
 * outstanding code for the email (so a brute-forcer can't rotate
 * between codes); 5 strikes invalidates.
 */
export async function verifyCheckoutCode(email: string, code: string): Promise<VerifyCodeResult> {
  const supabase = getSupabaseAdminClient();
  const normalized = email.toLowerCase().trim();

  const { data: rows } = await supabase
    .from("portal_login_tokens")
    .select("id, token_hash, expires_at, used_at, attempts")
    .eq("email", normalized)
    .eq("purpose", "checkout_code")
    .is("used_at", null)
    .order("created_at", { ascending: false })
    .limit(5);

  const live = (rows ?? []).filter((r) => new Date(r.expires_at).getTime() > Date.now());
  if (live.length === 0) return "expired";
  if (live.some((r) => (r.attempts ?? 0) >= MAX_ATTEMPTS)) return "too_many_attempts";

  const wanted = hashCode(normalized, code);
  const match = live.find((r) => r.token_hash === wanted);

  if (!match) {
    await supabase
      .from("portal_login_tokens")
      .update({ attempts: (live[0].attempts ?? 0) + 1 })
      .in("id", live.map((r) => r.id));
    return (live[0].attempts ?? 0) + 1 >= MAX_ATTEMPTS ? "too_many_attempts" : "invalid";
  }

  await supabase
    .from("portal_login_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("id", match.id);
  return "ok";
}
