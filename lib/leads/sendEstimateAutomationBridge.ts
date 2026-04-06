import type { ShopRecord } from "@/lib/dashboard/types";

type BridgeLeadPayload = {
  full_name: string;
  email: string;
  phone: string | null;
  service_requested: string | null;
  notes: string | null;
  source: string | null;
  vehicle_year: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
};

type EstimateAutomationBridgeBody = {
  webhook_secret?: string;
  full_name: string;
  email: string;
  phone: string;
  make_raw: string;
  model_raw: string;
  year: string;
  services_raw: string;
  notes: string;
  status: "new";
  quote_subject: string;
  quote_body: string;
  internal_notes: string;
  approved_size: string;
  suggested_size: string;
  confidence: string;
  reason_code: string;
  action: string;
  template_key: string;
  source: string;
  shop_slug: string;
  submitted_at: string;
};

function buildBridgeBody(
  shop: ShopRecord,
  lead: BridgeLeadPayload,
  webhookSecret?: string
): EstimateAutomationBridgeBody {
  return {
    ...(webhookSecret ? { webhook_secret: webhookSecret } : {}),
    full_name: lead.full_name,
    email: lead.email,
    phone: lead.phone ?? "",
    make_raw: lead.vehicle_make ?? "",
    model_raw: lead.vehicle_model ?? "",
    year: lead.vehicle_year ?? "",
    services_raw: lead.service_requested ?? "",
    notes: lead.notes ?? "",
    status: "new",
    quote_subject: "",
    quote_body: "",
    internal_notes: "",
    approved_size: "",
    suggested_size: "",
    confidence: "",
    reason_code: "",
    action: "",
    template_key: "",
    source: lead.source ?? "website-lead-form",
    shop_slug: shop.slug,
    submitted_at: new Date().toISOString(),
  };
}

export async function sendEstimateAutomationBridge({
  shop,
  lead,
}: {
  shop: ShopRecord;
  lead: BridgeLeadPayload;
}) {
  const webhookUrl = process.env.ESTIMATE_AUTOMATION_WEBHOOK_URL;

  if (!webhookUrl) {
    return;
  }

  const webhookSecret = process.env.ESTIMATE_AUTOMATION_WEBHOOK_SECRET;
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildBridgeBody(shop, lead, webhookSecret)),
  });

  if (!response.ok) {
    throw new Error(`Estimate automation bridge failed with status ${response.status}`);
  }
}
