import { NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

function getWebhookSecret() {
  const value = process.env.POSTMARK_WEBHOOK_SECRET;

  if (!value) {
    throw new Error("Missing required environment variable: POSTMARK_WEBHOOK_SECRET");
  }

  return value;
}

type PostmarkWebhookPayload = {
  MessageID?: string;
  RecordType?: string;
  DeliveredAt?: string;
  ReceivedAt?: string;
  // Bounce-specific
  Type?: string; // e.g. "HardBounce", "SoftBounce"
  Description?: string;
  Details?: string;
  BouncedAt?: string;
  // Click-specific
  ClickLocation?: string;
  OriginalLink?: string;
  ClickedAt?: string;
  // Open-specific
  FirstOpen?: boolean;
  ReadSeconds?: number;
  Metadata?: {
    email_message_id?: string;
    booking_id?: string;
    shop_id?: string;
    lead_id?: string;
    template_key?: string;
    template_variant?: string;
    [k: string]: string | undefined;
  };
  [key: string]: unknown;
};

export async function POST(request: Request) {
  const authHeader = request.headers.get("x-postmark-webhook-secret");

  if (authHeader !== getWebhookSecret()) {
    return NextResponse.json(
      { success: false, error: "Unauthorized webhook request." },
      { status: 401 }
    );
  }

  let payload: PostmarkWebhookPayload;

  try {
    payload = (await request.json()) as PostmarkWebhookPayload;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid webhook JSON payload." },
      { status: 400 }
    );
  }

  const emailMessageId = payload.Metadata?.email_message_id;
  const shopId = payload.Metadata?.shop_id;
  const leadId = payload.Metadata?.lead_id ?? null;

  if (!emailMessageId || !shopId) {
    return NextResponse.json(
      { success: false, error: "Missing email message metadata." },
      { status: 400 }
    );
  }

  const eventType = payload.RecordType?.toLowerCase() ?? "unknown";
  const eventTimestamp =
    payload.DeliveredAt ??
    payload.BouncedAt ??
    payload.ClickedAt ??
    payload.ReceivedAt ??
    new Date().toISOString();

  const supabase = getSupabaseAdminClient();

  // 1. Always log the raw event
  const { error: insertError } = await supabase.from("email_events").insert({
    shop_id: shopId,
    email_message_id: emailMessageId,
    event_type: eventType,
    event_timestamp: eventTimestamp,
    metadata_json: payload,
  });

  if (insertError) {
    return NextResponse.json(
      { success: false, error: "Failed to store email event." },
      { status: 500 }
    );
  }

  // 2. If this event pertains to a lead, update the lead's engagement columns
  //    (idempotent — COALESCE preserves earliest timestamp, status only moves forward).
  if (leadId) {
    try {
      await applyLeadEngagement(supabase, leadId, eventType, eventTimestamp, payload);
    } catch (err) {
      // Log but don't fail the webhook — Postmark will retry otherwise
      console.error("Failed to update lead engagement", { leadId, eventType, err });
    }
  }

  return NextResponse.json({ success: true });
}

/**
 * Update the lead's engagement denorm columns based on the event.
 * Uses "update only if null" pattern to preserve the earliest timestamp
 * (e.g. first click wins, not last click).
 */
async function applyLeadEngagement(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  leadId: string,
  eventType: string,
  eventTimestamp: string,
  payload: PostmarkWebhookPayload
) {
  // Fetch current state so we can decide what to update
  const { data: lead } = await supabase
    .from("leads")
    .select("id, status, email_delivered_at, email_opened_at, email_clicked_at, email_bounced_at")
    .eq("id", leadId)
    .maybeSingle();

  if (!lead) return;

  const patch: Record<string, unknown> = {};

  switch (eventType) {
    case "delivery":
      if (!lead.email_delivered_at) patch.email_delivered_at = eventTimestamp;
      break;
    case "open":
      // Apple Mail Privacy Protection pre-fetches pixels so this is noisy,
      // but the first recorded open is still better than nothing.
      if (!lead.email_opened_at) patch.email_opened_at = eventTimestamp;
      break;
    case "click":
      if (!lead.email_clicked_at) patch.email_clicked_at = eventTimestamp;
      // A click is a strong engagement signal — advance status to "clicked"
      // unless the lead is already past that (won/lost/quoted/contacted).
      if (lead.status === "sent") {
        patch.status = "clicked";
      }
      break;
    case "bounce":
    case "spamcomplaint":
      if (!lead.email_bounced_at) {
        patch.email_bounced_at = eventTimestamp;
        patch.email_bounce_reason =
          eventType === "spamcomplaint"
            ? "Spam complaint"
            : `${payload.Type ?? "Bounce"}: ${payload.Description ?? payload.Details ?? "unknown"}`;
      }
      break;
    default:
      return; // No-op for unrecognised event types
  }

  if (Object.keys(patch).length === 0) return;

  patch.updated_at = new Date().toISOString();

  const { error } = await supabase.from("leads").update(patch).eq("id", leadId);
  if (error) {
    console.error("Lead engagement update failed", { leadId, eventType, error });
  }
}
