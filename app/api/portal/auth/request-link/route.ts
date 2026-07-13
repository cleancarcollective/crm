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
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!email || !email.includes("@") || email.length > 320) {
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  }

  const contacts = await getPortalContacts(email);
  if (contacts.length === 0) {
    // Deliberate silent success - do not reveal which emails exist.
    return NextResponse.json({ ok: true });
  }

  if (await tooManyRecentTokens(email)) {
    return NextResponse.json({ ok: true });
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

  return NextResponse.json({ ok: true });
}
