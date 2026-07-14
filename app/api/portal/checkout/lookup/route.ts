/**
 * POST { email } → { known: boolean, hint?: string }
 *
 * Returning-customer recognition for the booking forms (Shop Pay
 * pattern). Response is deliberately minimal - a masked email hint at
 * most, never any PII: anyone can type anyone's email.
 */

import { NextRequest } from "next/server";

import { corsJson, corsPreflight } from "@/lib/portal/cors";
import { maskEmail } from "@/lib/portal/otp";
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
    return corsJson({ known: false });
  }

  const contacts = await getPortalContacts(email);
  if (contacts.length === 0) {
    return corsJson({ known: false });
  }
  return corsJson({ known: true, hint: maskEmail(email) });
}
