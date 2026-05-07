import Link from "next/link";

import { SmsTemplatesEditor } from "@/components/dashboard/SmsTemplatesEditor";
import { requireCurrentShop } from "@/lib/auth/currentShop";
import {
  SMS_TEMPLATE_DEFAULTS,
  SMS_TEMPLATE_KEY_LABELS,
  SMS_TEMPLATE_VARIABLES,
  type SmsTemplateKey,
} from "@/lib/sms/smsTemplateDefaults";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export default async function SmsTemplatesPage() {
  const shop = await requireCurrentShop();
  const supabase = getSupabaseAdminClient();

  const { data: rows, error } = await supabase
    .from("sms_templates")
    .select("id, template_key, name, body_text, is_active, updated_at")
    .eq("shop_id", shop.id)
    .order("template_key");

  if (error) {
    return (
      <main className="pageShell">
        <div className="pageTopbar">
          <p className="eyebrow">
            <Link href="/settings" className="eyebrowLink">← Back to Settings</Link>
          </p>
          <h1 className="pageTitle">SMS templates</h1>
        </div>
        <section className="detailPanel settingsSection">
          <p style={{ color: "#b23434" }}>
            <strong>Failed to load:</strong> {error.message}
          </p>
          <p className="settingsDescription">
            This usually means the <code>sms_templates</code> table hasn&apos;t been created yet.
            Run the SQL migration in Supabase, then refresh.
          </p>
        </section>
      </main>
    );
  }

  // Order rows by the canonical template-key order from defaults
  const orderedKeys = SMS_TEMPLATE_DEFAULTS.map((d) => d.template_key);
  const ordered = (rows ?? []).slice().sort(
    (a, b) =>
      orderedKeys.indexOf(a.template_key as SmsTemplateKey) -
      orderedKeys.indexOf(b.template_key as SmsTemplateKey)
  );

  return (
    <main className="pageShell">
      <div className="pageTopbar">
        <div>
          <p className="eyebrow">
            <Link href="/settings" className="eyebrowLink">← Back to Settings</Link>
          </p>
          <h1 className="pageTitle">SMS templates</h1>
          <p className="detailSubtitle">{shop.name}</p>
        </div>
      </div>

      <section className="detailPanel settingsSection">
        <h2>Customer text messages</h2>
        <p className="settingsDescription">
          The exact SMS messages sent at each touchpoint. Edits go live immediately —
          unsent messages re-render with the new text when their job fires.
        </p>
        <SmsTemplatesEditor
          templates={ordered.map((t) => ({
            id: t.id,
            template_key: t.template_key as SmsTemplateKey,
            name: t.name,
            body_text: t.body_text,
            is_active: t.is_active,
            label: SMS_TEMPLATE_KEY_LABELS[t.template_key as SmsTemplateKey] ?? t.template_key,
            variables: SMS_TEMPLATE_VARIABLES[t.template_key as SmsTemplateKey] ?? [],
          }))}
        />
      </section>
    </main>
  );
}
