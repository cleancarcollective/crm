/**
 * GET /api/leads/[id]/quick-send?token=...
 *
 * One-click "Send as-is" link from approval emails. The token is signed +
 * expires + single-use. On success: sends the lead's saved draft, flips the
 * lead to 'sent', schedules follow-ups, redirects to a confirmation page.
 *
 * No login required — that's the whole point. Auth is the token itself.
 */

import { NextResponse } from "next/server";

import { consumeActionToken, verifyActionToken } from "@/lib/auth/signedTokens";
import { getShopContactsById } from "@/lib/email/shopContacts";
import { cancelLeadJobs, scheduleLeadFollowups } from "@/lib/scheduling/leadJobs";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";

  const verify = await verifyActionToken(token, {
    requireAction: "lead_send_estimate",
    checkConsumed: true,
  });

  if (!verify.ok) {
    return redirectTo(url, `/lead-action/error?reason=${verify.reason}`);
  }

  if (verify.payload.r !== id) {
    return redirectTo(url, `/lead-action/error?reason=mismatch`);
  }

  const supabase = getSupabaseAdminClient();

  const { data: lead } = await supabase
    .from("leads")
    .select(
      "id, shop_id, contact_id, template_id, template_key, template_variant, status, quote_subject, quote_body, quote_html, contacts(email, first_name, phone)"
    )
    .eq("id", id)
    .eq("shop_id", verify.payload.s)
    .maybeSingle();

  if (!lead) return redirectTo(url, `/lead-action/error?reason=not_found`);

  const contact = lead.contacts as unknown as { email: string; first_name: string; phone: string | null } | null;
  if (!contact?.email) return redirectTo(url, `/lead-action/error?reason=no_email`);

  if (lead.status === "sent" || lead.status === "won" || lead.status === "lost") {
    // Already actioned — token still valid but the action is moot.
    return redirectTo(url, `/lead-action/already?status=${lead.status}`);
  }

  if (!lead.quote_subject || !lead.quote_body) {
    return redirectTo(url, `/lead-action/error?reason=no_draft`);
  }

  const postmarkToken = process.env.POSTMARK_SERVER_TOKEN;
  if (!postmarkToken) return redirectTo(url, `/lead-action/error?reason=server_misconfigured`);

  const shopContacts = await getShopContactsById(lead.shop_id);

  // Record outbound email for tracking
  const { data: messageRecord, error: insertError } = await supabase
    .from("email_messages")
    .insert({
      shop_id: lead.shop_id,
      contact_id: lead.contact_id,
      lead_id: lead.id,
      booking_id: null,
      template_id: null,
      subject: lead.quote_subject,
      body_rendered: lead.quote_html ?? lead.quote_body,
      status: "queued",
    })
    .select("id")
    .single();

  if (insertError || !messageRecord) {
    return redirectTo(url, `/lead-action/error?reason=insert_failed`);
  }

  const res = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": postmarkToken,
    },
    body: JSON.stringify({
      From: shopContacts.from_line,
      To: contact.email,
      Subject: lead.quote_subject,
      TextBody: lead.quote_body,
      HtmlBody: lead.quote_html ?? lead.quote_body,
      MessageStream: "booking-emails",
      TrackOpens: false,
      TrackLinks: "None",
      Metadata: {
        email_message_id: messageRecord.id,
        shop_id: lead.shop_id,
        lead_id: lead.id,
        template_key: lead.template_key ?? "manual_send",
        template_variant: lead.template_variant ?? "A",
        auto_template_id: lead.template_id ?? "none",
        send_mode: "approval_quick_send",
      },
    }),
  });

  if (!res.ok) {
    await supabase.from("email_messages").update({ status: "failed" }).eq("id", messageRecord.id);
    return redirectTo(url, `/lead-action/error?reason=send_failed`);
  }

  const response = (await res.json()) as { MessageID?: string };
  await supabase
    .from("email_messages")
    .update({
      provider_message_id: response.MessageID ?? null,
      status: "sent",
      sent_at: new Date().toISOString(),
    })
    .eq("id", messageRecord.id);

  // Flip the lead to sent
  await supabase
    .from("leads")
    .update({
      status: "sent",
      internal_notes: "",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("shop_id", lead.shop_id);

  // Cancel any pending auto-estimate, schedule follow-ups
  await cancelLeadJobs(id, ["lead_auto_estimate"]);

  // Look up vehicle for the SMS follow-up
  const { data: leadWithVehicle } = await supabase
    .from("leads")
    .select("vehicles(make, model)")
    .eq("id", id)
    .maybeSingle();
  const vehicle =
    (leadWithVehicle?.vehicles as unknown as { make: string | null; model: string | null } | null) ?? null;

  await scheduleLeadFollowups({
    shopId: lead.shop_id,
    leadId: lead.id,
    contactId: lead.contact_id,
    email: contact.email,
    phone: contact.phone,
    firstName: contact.first_name,
    make: vehicle?.make ?? null,
    model: vehicle?.model ?? null,
  });

  // Mark token as consumed so the same link can't be replayed
  await consumeActionToken(token, verify.payload);

  return redirectTo(url, `/lead-action/sent?lead=${id}`);
}

function redirectTo(currentUrl: URL, path: string): Response {
  const target = new URL(path, currentUrl.origin);
  return NextResponse.redirect(target.toString(), { status: 303 });
}
