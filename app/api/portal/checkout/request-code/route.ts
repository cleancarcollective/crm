/**
 * POST { email } → { ok: true }
 *
 * Emails a 6-digit checkout code. Silent success for unknown emails
 * (no enumeration). Max 3 outstanding codes per email.
 */

import { NextRequest } from "next/server";

import { corsJson, corsPreflight } from "@/lib/portal/cors";
import { sendCheckoutCodeEmail } from "@/lib/portal/emails";
import { activeCodeCount, createCheckoutCode } from "@/lib/portal/otp";
import { getPortalContacts } from "@/lib/portal/session";

export async function OPTIONS() {
  return corsPreflight();
}

export async function POST(req: NextRequest) {
  let email = "";
  try {
    const body = (await req.json()) as { email?: string };
    email = (body.email ?? "").toLowerCase().trim();
  } catch {
    return corsJson({ error: "Invalid request" }, { status: 400 });
  }
  if (!email || !email.includes("@") || email.length > 320) {
    return corsJson({ error: "Enter a valid email address" }, { status: 400 });
  }

  const contacts = await getPortalContacts(email);
  if (contacts.length === 0) {
    return corsJson({ ok: true });
  }
  if ((await activeCodeCount(email)) >= 3) {
    return corsJson({ ok: true });
  }

  const code = await createCheckoutCode(email);
  const primary = contacts[0];
  await sendCheckoutCodeEmail({
    email,
    code,
    shopId: primary.shop_id,
    contactId: primary.id,
    firstName: primary.first_name,
  });

  return corsJson({ ok: true });
}
