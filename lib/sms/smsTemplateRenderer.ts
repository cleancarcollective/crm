/**
 * Loads + renders SMS templates from the sms_templates table, with
 * graceful fallback to SMS_TEMPLATE_DEFAULTS when:
 *   - The shop has no row for that key yet (initial migration)
 *   - The query fails for any reason (we never want to skip an SMS
 *     just because a template lookup failed)
 */

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

import { SMS_TEMPLATE_DEFAULTS, type SmsTemplateKey } from "./smsTemplateDefaults";

export type SmsTemplateRecord = {
  id: string | null;
  template_key: SmsTemplateKey;
  name: string;
  body_text: string;
  is_active: boolean;
};

export async function loadSmsTemplate(shopId: string, key: SmsTemplateKey): Promise<SmsTemplateRecord> {
  const supabase = getSupabaseAdminClient();
  try {
    const { data } = await supabase
      .from("sms_templates")
      .select("id, template_key, name, body_text, is_active")
      .eq("shop_id", shopId)
      .eq("template_key", key)
      .eq("is_active", true)
      .maybeSingle();

    if (data) return data as SmsTemplateRecord;
  } catch (err) {
    console.warn("loadSmsTemplate DB error — falling back to default", { key, err });
  }

  // Fallback to code default
  const def = SMS_TEMPLATE_DEFAULTS.find((d) => d.template_key === key);
  if (!def) {
    throw new Error(`No default for sms template key: ${key}`);
  }
  return {
    id: null,
    template_key: def.template_key,
    name: def.name,
    body_text: def.body_text,
    is_active: true,
  };
}

/** Substitute {{var}} tokens. Missing variables stay as the literal token (so
 *  it's obvious in the rendered message that something's wrong). */
export function renderSmsBody(template: SmsTemplateRecord, ctx: Record<string, string>): string {
  return template.body_text.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(ctx, key)) return ctx[key];
    return match;
  });
}

/** One-shot convenience — most call sites use this. */
export async function loadAndRenderSms(
  shopId: string,
  key: SmsTemplateKey,
  ctx: Record<string, string>
): Promise<{ body: string; templateId: string | null }> {
  const tpl = await loadSmsTemplate(shopId, key);
  return {
    body: renderSmsBody(tpl, ctx),
    templateId: tpl.id,
  };
}
