/**
 * POST { email } - customer requests a magic sign-in link.
 *
 * Always responds { ok: true } whether or not the email exists, so the
 * endpoint can't be used to enumerate the customer base. A link is only
 * actually sent when at least one contact matches.
 */

import { NextRequest, NextResponse } from "next/server";

import { sendMagicLinkEmail } from "@/lib/portal/emails";
import { createLoginToken, getPortalContacts } from "@/lib/portal/session";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

// The booking forms (embedded on cleancarcollective.co.nz) call this
// cross-origin from the thank-you screen. Safe to open: no cookies are
// read, the response carries no data, and unknown emails silently
// succeed - CORS here only enables the one-click "activate my account"
// button.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// Basic per-email throttle: max 3 unexpired tokens outstanding.
async function tooManyRecentTokens(email: string): Promise<boolean> {
  const supabase = getSupabaseAdminClient();
  const { count } = await supabase
    .from("portal_login_tokens")
    .select("id", { count: "exact", head: true })
    .eq("email", email)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString());
  return (count ?? 0) >= 3;
}

export async function POST(req: NextRequest) {
  let email = "";
  try {
    const body = (await req.json()) as { email?: string };
    email = (body.email ?? "").toLowerCase().trim();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400, headers: CORS_HEADERS });
  }

  if (!email || !email.includes("@") || email.length > 320) {
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400, headers: CORS_HEADERS });
  }

  const contacts = await getPortalContacts(email);
  if (contacts.length === 0) {
    // Deliberate silent success - do not reveal which emails exist.
    return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
  }

  if (await tooManyRecentTokens(email)) {
    return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
  }

  const token = await createLoginToken(email);
  const primary = contacts[0];
  await sendMagicLinkEmail({
    email,
    token,
    shopId: primary.shop_id,
    contactId: primary.id,
    firstName: primary.first_name,
  });

  return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
}
