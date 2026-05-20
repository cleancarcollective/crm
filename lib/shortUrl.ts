/**
 * Short URL helper. Mainly used to keep SMS messages within character limits
 * (signed JWTs in lock-in URLs are ~150 chars on their own).
 *
 * The redirect handler lives at app/r/[code]/route.ts.
 */

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

const CRM_BASE_URL = process.env.CRM_BASE_URL ?? "https://crm.cleancarcollective.co.nz";
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
// 7 chars = ~55^7 = 1.3 trillion possibilities. Collisions are vanishingly
// rare even at million-link scale; the unique constraint catches any anyway.
const CODE_LENGTH = 7;

function generateCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

export type CreateShortUrlInput = {
  fullUrl: string;
  shopId?: string | null;
  purpose?: string | null;
  /** Defaults to 60 days. The token inside the URL has its own expiry (30 days). */
  expiresInSeconds?: number;
};

/**
 * Insert a short_urls row and return the short URL. Retries on the rare
 * unique-violation collision; falls back to the full URL if the DB write
 * fails (caller already has a working URL, so the SMS still works - just
 * stays long).
 */
export async function createShortUrl(input: CreateShortUrlInput): Promise<string> {
  const supabase = getSupabaseAdminClient();
  const ttl = input.expiresInSeconds ?? 60 * 24 * 60 * 60;
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateCode();
    const { error } = await supabase.from("short_urls").insert({
      short_code: code,
      full_url: input.fullUrl,
      shop_id: input.shopId ?? null,
      purpose: input.purpose ?? null,
      expires_at: expiresAt,
    });
    if (!error) return `${CRM_BASE_URL}/r/${code}`;
    // 23505 = unique_violation. Retry with a new code.
    if (error.code !== "23505") {
      console.error("createShortUrl: insert failed, falling back to long URL", error);
      return input.fullUrl;
    }
  }
  console.warn("createShortUrl: gave up after 3 collisions, falling back to long URL");
  return input.fullUrl;
}
