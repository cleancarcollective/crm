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
  Metadata?: {
    email_message_id?: string;
    booking_id?: string;
    shop_id?: string;
  };
  [key: string]: unknown;
};

export async function POST(request: Request) {
  const authHeader = request.headers.get("x-postmark-webhook-secret");

  if (authHeader !== getWebhookSecret()) {
    return NextResponse.json(
      {
        success: false,
        error: "Unauthorized webhook request."
      },
      { status: 401 }
    );
  }

  let payload: PostmarkWebhookPayload;

  try {
    payload = (await request.json()) as PostmarkWebhookPayload;
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid webhook JSON payload."
      },
      { status: 400 }
    );
  }

  const emailMessageId = payload.Metadata?.email_message_id;
  const shopId = payload.Metadata?.shop_id;

  if (!emailMessageId || !shopId) {
    return NextResponse.json(
      {
        success: false,
        error: "Missing email message metadata."
      },
      { status: 400 }
    );
  }

  const eventType = payload.RecordType?.toLowerCase() ?? "unknown";
  const eventTimestamp = payload.DeliveredAt ?? payload.ReceivedAt ?? new Date().toISOString();

  const supabase = getSupabaseAdminClient();

  const { error } = await supabase
    .from("email_events")
    .insert({
      shop_id: shopId,
      email_message_id: emailMessageId,
      event_type: eventType,
      event_timestamp: eventTimestamp,
      metadata_json: payload
    });

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Failed to store email event."
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
