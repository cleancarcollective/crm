/**
 * Manually send the approved estimate for a lead that hit 'needs_approval'.
 *
 * Mirrors the auto-respond send path (processLead.sendEstimateEmail):
 *   - Creates an email_messages row for tracking
 *   - Sends via Postmark with Metadata so click/open webhooks attribute back
 *   - Tracking OFF (matches auto-respond — keeps emails out of Promotions)
 *   - Advances lead status to 'sent'
 */

import { NextRequest, NextResponse } from "next/server";
import { getShopContactsById } from "@/lib/email/shopContacts";
import { cancelLeadJobs, scheduleLeadFollowups } from "@/lib/scheduling/leadJobs";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { subject, body: textBody } = body as {
    subject: string;
    body: string;
  };

  if (!subject || !textBody) {
    return NextResponse.json({ error: "subject and body required" }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();

  const { data: lead } = await supabase
    .from("leads")
    .select("id, shop_id, contact_id, template_id, template_key, template_variant, contacts(email, first_name, phone)")
    .eq("id", id)
    .maybeSingle();

  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const contact = lead.contacts as unknown as { email: string; first_name: string; phone: string | null } | null;
  if (!contact?.email) {
    return NextResponse.json({ error: "Contact has no email" }, { status: 400 });
  }

  const postmarkToken = process.env.POSTMARK_SERVER_TOKEN;
  if (!postmarkToken) {
    return NextResponse.json({ error: "POSTMARK_SERVER_TOKEN not set" }, { status: 500 });
  }

  const htmlBody = buildHtml(textBody);

  // 1. Record the outbound email with full attribution
  const { data: messageRecord, error: insertError } = await supabase
    .from("email_messages")
    .insert({
      shop_id: lead.shop_id,
      contact_id: lead.contact_id,
      lead_id: lead.id,
      booking_id: null,
      template_id: null, // booking templates live here; ours is in Metadata
      subject,
      body_rendered: htmlBody,
      status: "queued",
    })
    .select("id")
    .single();

  if (insertError || !messageRecord) {
    return NextResponse.json(
      { error: `email_messages insert failed: ${insertError?.message ?? "no row"}` },
      { status: 500 }
    );
  }

  // 2. Resolve per-shop sender + send via Postmark with tracking + metadata
  const shopContacts = await getShopContactsById(lead.shop_id);
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
      Subject: subject,
      TextBody: textBody,
      HtmlBody: htmlBody,
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
        send_mode: "manual_approval",
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    await supabase.from("email_messages").update({ status: "failed" }).eq("id", messageRecord.id);
    return NextResponse.json(
      { error: `Email send failed: ${text.slice(0, 200)}` },
      { status: 500 }
    );
  }

  const response = (await res.json()) as { MessageID?: string };

  // 3. Mark email as sent
  await supabase
    .from("email_messages")
    .update({
      provider_message_id: response.MessageID ?? null,
      status: "sent",
      sent_at: new Date().toISOString(),
    })
    .eq("id", messageRecord.id);

  // 4. Advance lead status
  await supabase
    .from("leads")
    .update({
      status: "sent",
      quote_subject: subject,
      quote_body: textBody,
      quote_html: htmlBody,
      internal_notes: "",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  // 5. Cancel any still-pending auto-estimate (e.g. admin sent manually
  //    before the 3-min delay elapsed). Then schedule follow-ups.
  await cancelLeadJobs(id, ["lead_auto_estimate", "lead_followup_3day", "lead_followup_7day"]);

  // Load vehicle info so follow-up templates can render with {{vehicle}}
  const { data: vehicleRow } = await supabase
    .from("leads")
    .select("vehicles(make, model)")
    .eq("id", id)
    .maybeSingle();
  const vehicle = (vehicleRow?.vehicles as unknown as { make: string | null; model: string | null } | null) ?? null;

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

  return NextResponse.json({ ok: true });
}

function buildHtml(plain: string): string {
  const bookingUrl = "https://cleancarcollective.co.nz/make-a-booking/";
  let html = plain
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  html = html.replace(
    bookingUrl.replace(/&/g, "&amp;"),
    `<a href="${bookingUrl}" style="color:#1a73e8;text-decoration:underline;">make a booking here</a>`
  );
  return `<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.6;white-space:pre-wrap;">${html}</div>`;
}
