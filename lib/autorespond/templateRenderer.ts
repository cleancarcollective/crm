/**
 * DB-backed email template renderer for auto-respond estimates.
 *
 * Flow:
 *   1. loadTemplate(shopId, key) — fetch from lead_email_templates table.
 *      Falls back to TEMPLATE_DEFAULTS if no DB row exists (during migration).
 *   2. buildTemplateContext(...) — assembles the {name, vehicle, *_price} map.
 *   3. renderTemplate(template, ctx) — substitutes {{vars}} + returns
 *      { subject, textBody, htmlBody, templateId, variant }.
 */

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { TEMPLATE_DEFAULTS } from "./templateDefaults";
import type { TemplateKey } from "./templates";
import type { VehicleSize } from "./vehicleSizing";

export type PricingMap = Map<string, number>; // "ServiceName|Size" -> price_ex_gst

export type TemplateRecord = {
  id: string | null; // null if falling back to default (no DB row)
  shop_id: string | null;
  template_key: TemplateKey;
  variant: string;
  name: string;
  subject: string;
  body_text: string;
  is_active: boolean;
  weight?: number; // relative weight for A/B distribution (default 100)
};

/**
 * Pick one variant using weighted random selection.
 * Variants with weight 0 are skipped. If all weights are 0, returns the first.
 */
function pickWeightedVariant(variants: TemplateRecord[]): TemplateRecord {
  const withWeights = variants.map((v) => ({ ...v, _w: Math.max(0, v.weight ?? 100) }));
  const total = withWeights.reduce((sum, v) => sum + v._w, 0);
  if (total === 0) return variants[0];
  let roll = Math.random() * total;
  for (const v of withWeights) {
    roll -= v._w;
    if (roll <= 0) return v;
  }
  return variants[variants.length - 1];
}

export type RenderedTemplate = {
  subject: string;
  textBody: string;
  htmlBody: string;
  templateId: string | null;
  templateKey: TemplateKey;
  variant: string;
};

const BOOKING_URL = "https://cleancarcollective.co.nz/make-a-booking/";

// ── HTML wrapping ──────────────────────────────────────────────────────────

function htmlBody(plain: string): string {
  let html = plain
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

  const escapedUrl = BOOKING_URL.replace(/&/g, "&amp;");
  html = html.replace(
    escapedUrl,
    `<a href="${BOOKING_URL}" style="color:#1a73e8;text-decoration:underline;">make a booking here</a>`
  );
  html = html.replace(
    /If you&#39;d like to make a booking, you can do so here: <a /,
    "If you&#39;d like to make a booking, you can <a "
  );

  return `<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.6;white-space:pre-wrap;">${html}</div>`;
}

// ── String helpers ─────────────────────────────────────────────────────────

function titleCase(str: string): string {
  return (str || "")
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function vehicleDisplay(makeRaw: string, modelRaw: string): string {
  let model = (modelRaw || "").toLowerCase();
  model = model.replace(/\b(19|20)\d{2}\b/g, "");
  model = model.replace(/\b(white|black|silver|grey|gray|blue|red|green|gold|beige)\b/g, "");
  model = model.replace(/\b(hatch|hatchback|wagon|estate|sedan|saloon|coupe|convertible|ute|van|station)\b/g, "");
  model = model.replace(/\b(auto|automatic|manual|petrol|diesel|hybrid|awd|fwd|rwd)\b/g, "");
  model = titleCase(model.replace(/\s+/g, " ").trim());
  const make = titleCase(makeRaw || "");
  return [make, model].filter(Boolean).join(" ").trim() || "your vehicle";
}

function fmtPrice(price: number | null | undefined): string {
  if (price === null || price === undefined) return "price on request";
  return `$${price} + GST`;
}

function getPrice(pricing: PricingMap, serviceName: string, size: string): number | null {
  const key = `${serviceName}|${size}`;
  const price = pricing.get(key);
  return price === undefined ? null : price;
}

// ── Context building ───────────────────────────────────────────────────────

/**
 * Build the variable context for a given template key, pricing map, and lead info.
 * Returns a flat object mapping variable names to their rendered values.
 */
export function buildTemplateContext(
  templateKey: TemplateKey,
  firstName: string,
  makeRaw: string,
  modelRaw: string,
  size: VehicleSize | null,
  pricing: PricingMap
): Record<string, string> {
  const name = titleCase(firstName) || "there";
  const vehicle = vehicleDisplay(makeRaw, modelRaw);
  const sizeKey = size ?? "Any";

  const base: Record<string, string> = { name, vehicle };

  switch (templateKey) {
    case "inside_out":
      return {
        ...base,
        deluxe_price: fmtPrice(getPrice(pricing, "Deluxe Detail", sizeKey)),
        premium_price: fmtPrice(getPrice(pricing, "Premium Detail", sizeKey)),
      };
    case "interior_only":
      return {
        ...base,
        deluxe_interior_price: fmtPrice(getPrice(pricing, "Deluxe Interior Detail", sizeKey)),
        premium_interior_price: fmtPrice(getPrice(pricing, "Premium Interior Detail", sizeKey)),
      };
    case "exterior_only":
      return {
        ...base,
        deluxe_exterior_price: fmtPrice(getPrice(pricing, "Deluxe Exterior Detail", sizeKey)),
        premium_exterior_price: fmtPrice(getPrice(pricing, "Premium Exterior Detail", sizeKey)),
      };
    case "ceramic":
      return {
        ...base,
        bronze_price: fmtPrice(getPrice(pricing, "Ceramic Bronze (1 Year)", "Any")),
        silver_price: fmtPrice(getPrice(pricing, "Ceramic Silver (2 Year)", "Any")),
        gold_price: fmtPrice(getPrice(pricing, "Ceramic Gold (5 Year)", "Any")),
      };
    case "paint_correction":
      return {
        ...base,
        one_step_price: fmtPrice(getPrice(pricing, "Paint Correction 1-Step", "Any")),
        two_step_price: fmtPrice(getPrice(pricing, "Paint Correction 2-Step", "Any")),
      };
    case "other":
    case "lead_followup_3day":
    case "lead_followup_7day":
      return base;
    default:
      return base;
  }
}

/**
 * Substitute {{variable}} tokens in a template string.
 * Missing variables render as the literal token, to make it obvious in preview.
 */
function substitute(template: string, ctx: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(ctx, key)) {
      return ctx[key];
    }
    return match; // leave unresolved for visibility
  });
}

// ── DB load + fallback ─────────────────────────────────────────────────────

/**
 * Load the active template for a given shop + key. If multiple active variants
 * exist (A/B test), picks one by weighted random.
 *
 * If `variant` is explicitly specified (e.g. from a lead's historical record),
 * returns that specific variant. Otherwise does a weighted random pick.
 *
 * Falls back to TEMPLATE_DEFAULTS if no DB row exists.
 */
export async function loadTemplate(
  shopId: string,
  templateKey: TemplateKey,
  variant?: string
): Promise<TemplateRecord> {
  const supabase = getSupabaseAdminClient();

  if (variant) {
    // Specific variant requested — exact load
    const { data, error } = await supabase
      .from("lead_email_templates")
      .select("id, shop_id, template_key, variant, name, subject, body_text, is_active, weight")
      .eq("shop_id", shopId)
      .eq("template_key", templateKey)
      .eq("variant", variant)
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      console.error("loadTemplate DB error:", error.message);
    }
    if (data) return data as TemplateRecord;
  } else {
    // No variant specified — pick by weighted random over all active variants
    const { data, error } = await supabase
      .from("lead_email_templates")
      .select("id, shop_id, template_key, variant, name, subject, body_text, is_active, weight")
      .eq("shop_id", shopId)
      .eq("template_key", templateKey)
      .eq("is_active", true);

    if (error) {
      console.error("loadTemplate DB error:", error.message);
    }

    const variants = (data ?? []) as TemplateRecord[];
    if (variants.length === 1) return variants[0];
    if (variants.length > 1) {
      const picked = pickWeightedVariant(variants);
      console.info("A/B pick:", {
        templateKey,
        chosen: picked.variant,
        available: variants.map((v) => ({ variant: v.variant, weight: v.weight })),
      });
      return picked;
    }
  }

  // Fallback to code default
  const def =
    TEMPLATE_DEFAULTS.find((t) => t.template_key === templateKey && t.variant === (variant ?? "A")) ??
    TEMPLATE_DEFAULTS.find((t) => t.template_key === templateKey) ??
    TEMPLATE_DEFAULTS.find((t) => t.template_key === "other")!;

  return {
    id: null,
    shop_id: null,
    template_key: def.template_key,
    variant: def.variant,
    name: def.name,
    subject: def.subject,
    body_text: def.body_text,
    is_active: true,
  };
}

/**
 * Render a template with the given context. Returns subject + text + html bodies.
 */
export function renderTemplate(template: TemplateRecord, ctx: Record<string, string>): RenderedTemplate {
  const subject = substitute(template.subject, ctx);
  const textBody = substitute(template.body_text, ctx);
  return {
    subject,
    textBody,
    htmlBody: htmlBody(textBody),
    templateId: template.id,
    templateKey: template.template_key,
    variant: template.variant,
  };
}

/**
 * One-shot convenience: load + render.
 * If `variant` is omitted, loadTemplate picks one by weighted random
 * over all active variants (A/B testing). Pass a specific variant when
 * you need to re-render a historical message.
 */
export async function loadAndRenderTemplate(
  shopId: string,
  templateKey: TemplateKey,
  ctx: Record<string, string>,
  variant?: string
): Promise<RenderedTemplate> {
  const template = await loadTemplate(shopId, templateKey, variant);
  return renderTemplate(template, ctx);
}
