import Link from "next/link";
import { notFound } from "next/navigation";

import { requireCurrentShop } from "@/lib/auth/currentShop";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { TEMPLATE_KEY_LABELS, TEMPLATE_VARIABLES } from "@/lib/autorespond/templateDefaults";
import type { TemplateKey } from "@/lib/autorespond/templates";
import { TemplateEditor } from "@/components/dashboard/TemplateEditor";

export default async function TemplateEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const shop = await requireCurrentShop();
  const supabase = getSupabaseAdminClient();

  // Scoped read: only this shop's templates can be loaded — prevents
  // a CHC user from peeking at WLG templates by guessing the URL.
  const { data: template } = await supabase
    .from("lead_email_templates")
    .select("*")
    .eq("id", id)
    .eq("shop_id", shop.id)
    .maybeSingle();

  if (!template) notFound();

  const key = template.template_key as TemplateKey;
  const variables = TEMPLATE_VARIABLES[key] ?? [];

  // Sibling variants of the same template_key (for A/B test UI)
  const { data: siblingRows } = await supabase
    .from("lead_email_templates")
    .select("id, variant, weight, is_active")
    .eq("shop_id", shop.id)
    .eq("template_key", template.template_key)
    .neq("id", template.id)
    .order("variant");

  const siblings = (siblingRows ?? []).map((s) => ({
    id: s.id as string,
    variant: s.variant as string,
    weight: (s.weight ?? 100) as number,
    is_active: (s.is_active ?? true) as boolean,
  }));

  return (
    <main className="pageShell">
      <div className="pageTopbar">
        <div>
          <p className="eyebrow">
            <Link href="/settings/templates" className="eyebrowLink">← Back to Templates</Link>
          </p>
          <h1 className="pageTitle">{TEMPLATE_KEY_LABELS[key] ?? template.template_key}</h1>
          <p className="detailSubtitle">{shop.name}</p>
        </div>
      </div>

      <TemplateEditor
        template={{
          id: template.id,
          template_key: template.template_key,
          variant: template.variant,
          name: template.name,
          subject: template.subject,
          body_text: template.body_text,
          is_active: template.is_active,
          weight: template.weight ?? 100,
        }}
        variables={variables}
        siblings={siblings}
      />
    </main>
  );
}
