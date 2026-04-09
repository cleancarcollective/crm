import { NextRequest, NextResponse } from "next/server";
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
    .select("id, contact_id, contacts(email, first_name)")
    .eq("id", id)
    .maybeSingle();

  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const contact = lead.contacts as unknown as { email: string; first_name: string } | null;
  if (!contact?.email) {
    return NextResponse.json({ error: "Contact has no email" }, { status: 400 });
  }

  function buildHtml(plain: string): string {
    const bookingUrl = "https://cleancarcollective.co.nz/make-a-booking/";
    let html = plain.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    html = html.replace(
      bookingUrl.replace(/&/g, "&amp;"),
      `<a href="${bookingUrl}" style="color:#1a73e8;text-decoration:underline;">make a booking here</a>`
    );
    return `<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.6;white-space:pre-wrap;">${html}</div>`;
  }

  const postmarkToken = process.env.POSTMARK_API_TOKEN;
  if (!postmarkToken) return NextResponse.json({ error: "POSTMARK_API_TOKEN not set" }, { status: 500 });

  const res = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": postmarkToken,
    },
    body: JSON.stringify({
      From: "Max from Clean Car Collective <max@cleancarcollective.co.nz>",
      To: contact.email,
      Subject: subject,
      TextBody: textBody,
      HtmlBody: buildHtml(textBody),
      MessageStream: "booking-emails",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json({ error: `Email send failed: ${text.slice(0, 200)}` }, { status: 500 });
  }

  await supabase.from("leads").update({
    status: "sent",
    quote_subject: subject,
    quote_body: textBody,
    internal_notes: "",
    updated_at: new Date().toISOString(),
  }).eq("id", id);

  return NextResponse.json({ ok: true });
}
