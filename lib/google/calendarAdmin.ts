/**
 * Direct Google Calendar API client for admin writes.
 *
 * Uses a service account (JWT bearer flow) to authenticate. Pure Node —
 * RS256 JWT signing via `crypto.createSign`, then exchange JWT for an
 * OAuth access token at https://oauth2.googleapis.com/token, then call
 * Calendar API v3 directly via fetch. No npm deps.
 *
 * Why service account: writes from the CRM's serverless functions need
 * to work without any user context (the CRM call may come from a logged-in
 * staff session but the OAuth flow against Google would still need a
 * separate user grant). A service account avoids that — share each
 * calendar with the service account's email as "Make changes to events"
 * and the CRM can write to it forever.
 *
 * Why no Apps Script: deployment versioning, URL churn, dropped helpers
 * on paste, and timezone surprises burned us repeatedly. Calling Google
 * directly is more code here but zero out-of-band moving parts.
 *
 * Setup steps (user-side, one-time):
 *   1. Create a service account in GCP, download the JSON key.
 *   2. Share each calendar with the service account email
 *      ("Make changes to events" permission).
 *   3. Paste the full JSON into the GOOGLE_SERVICE_ACCOUNT_JSON Vercel
 *      env var.
 */

import { createSign } from "node:crypto";

export type CalendarType = "shop" | "mobile";
export type ShopSlug = "christchurch" | "wellington";

/**
 * Source of truth for calendar IDs. Mirrors the per-shop Apps Script
 * `CALENDARS` maps used for availability reads — same calendars,
 * different access path. Adding a third shop = add an entry here and
 * share its calendars with the service account email.
 */
export const CALENDARS_BY_SHOP: Record<ShopSlug, Record<CalendarType, string>> = {
  christchurch: {
    shop: "c_07c287c1f8b495d55ae5c286647ae0e99b27cdd3ee854610495e90b0eadd0862@group.calendar.google.com",
    mobile: "c_d16bca64acba6779bff0ec947390c3eda7bd5fbf454fc2ac67000ada29179f3b@group.calendar.google.com",
  },
  wellington: {
    shop: "c_25a4e8a5e7a17b1fb9bdae052bee6cd49732adf8c6a6a3795749c82747de8f23@group.calendar.google.com",
    mobile: "c_03cffbad46b98895eb5e06b23211cf4affbe5d405413e91f620f4c0e0b61aee6@group.calendar.google.com",
  },
};

const DEFAULT_TZ = "Pacific/Auckland";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPES = "https://www.googleapis.com/auth/calendar.events";

// Token + parsed credentials cached at module level. Serverless lambdas
// may not share these across instances; each cold start does one extra
// token call. That's fine — Google's token endpoint is fast (~150ms).
type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};
let cachedAccount: ServiceAccount | null = null;
let cachedToken: { token: string; expiresAt: number } | null = null;

function loadServiceAccount(): ServiceAccount {
  if (cachedAccount) return cachedAccount;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set");
  }
  let parsed: ServiceAccount;
  try {
    parsed = JSON.parse(raw) as ServiceAccount;
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON");
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("Service account JSON missing client_email or private_key");
  }
  // Vercel sometimes escapes \n in the env var; normalise.
  if (parsed.private_key.includes("\\n")) {
    parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  }
  cachedAccount = parsed;
  return parsed;
}

function base64UrlEncode(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
  return buf
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signJwt(account: ServiceAccount): string {
  // Per Google's docs:
  // https://developers.google.com/identity/protocols/oauth2/service-account
  //
  // When GOOGLE_CALENDAR_IMPERSONATE_EMAIL is set, we use Domain-Wide
  // Delegation: the service account acts AS that Workspace user, inheriting
  // their existing calendar permissions. This is required for our setup
  // because Google Workspace blocks granting "Make changes to events" to
  // external service-account emails — the "Make changes" dropdown is
  // permanently greyed out. DWD bypasses that policy by having the SA
  // impersonate a Workspace user (typically the owner/manager of the
  // calendars), and Calendar API then sees the request as coming from
  // that user.
  //
  // Setup (one-time, admin.google.com):
  //   Security → Access and data control → API controls →
  //   Manage Domain Wide Delegation → Add new →
  //   Client ID = service account's OAuth Client ID,
  //   Scopes = https://www.googleapis.com/auth/calendar.events
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const impersonate = process.env.GOOGLE_CALENDAR_IMPERSONATE_EMAIL?.trim();
  const claim: Record<string, unknown> = {
    iss: account.client_email,
    scope: SCOPES,
    aud: account.token_uri ?? TOKEN_URL,
    exp: nowSec + 3600,
    iat: nowSec,
  };
  if (impersonate) claim.sub = impersonate;
  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const claimB64 = base64UrlEncode(JSON.stringify(claim));
  const signingInput = `${headerB64}.${claimB64}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  const signature = signer.sign(account.private_key);
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  // Reuse within ~50 minutes (Google issues 1h tokens — leave headroom).
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.token;
  }
  const account = loadServiceAccount();
  const jwt = signJwt(account);
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt,
  });
  const res = await fetch(account.token_uri ?? TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Token exchange failed HTTP ${res.status}: ${txt.slice(0, 300)}`);
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!data.access_token) {
    throw new Error(`Token response missing access_token: ${data.error_description ?? data.error ?? "unknown"}`);
  }
  cachedToken = {
    token: data.access_token,
    expiresAt: now + (data.expires_in ?? 3600) * 1000,
  };
  return cachedToken.token;
}

export type CreateEventArgs = {
  calendarId: string;
  /** Event title. The block-day caller prefixes with "Blocked via CRM —". */
  title: string;
  scope: "time_range" | "all_day";
  /** "yyyy-MM-dd". Required for both scope variants. */
  date: string;
  /** "HH:mm" — required when scope=time_range. */
  startTime?: string;
  endTime?: string;
  /** Defaults to Pacific/Auckland. */
  timeZone?: string;
};

export type CreateEventResult = {
  id: string;
  htmlLink?: string;
};

/**
 * Create an event on the given calendar.
 *
 * For all-day events, Google Calendar expects end.date to be EXCLUSIVE
 * (the day after the block). We compute that here so callers don't
 * have to.
 */
export async function createCalendarEvent(args: CreateEventArgs): Promise<CreateEventResult> {
  const tz = args.timeZone ?? DEFAULT_TZ;
  const body: Record<string, unknown> = { summary: args.title };

  if (args.scope === "time_range") {
    if (!args.startTime || !args.endTime) {
      throw new Error("startTime and endTime required for scope=time_range");
    }
    // Pass the local wall-clock time + IANA timeZone — Google handles the
    // local→UTC conversion based on the timeZone field. Avoids the bug we
    // hit with Apps Script where the project TZ silently shifted events.
    body.start = { dateTime: `${args.date}T${args.startTime}:00`, timeZone: tz };
    body.end = { dateTime: `${args.date}T${args.endTime}:00`, timeZone: tz };
  } else {
    // All-day event. start.date = block day, end.date = next day
    // (exclusive per Calendar API spec).
    body.start = { date: args.date };
    body.end = { date: addOneDay(args.date) };
  }

  const token = await getAccessToken();
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(args.calendarId)}/events`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Calendar API ${res.status}: ${txt.slice(0, 400)}`);
  }
  const event = (await res.json()) as { id?: string; htmlLink?: string };
  if (!event.id) {
    throw new Error("Calendar API returned no event id");
  }
  return { id: event.id, htmlLink: event.htmlLink };
}

function addOneDay(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  // Use UTC math so we never tip over a DST boundary in either direction.
  const date = new Date(Date.UTC(y as number, (m as number) - 1, d as number));
  date.setUTCDate(date.getUTCDate() + 1);
  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
