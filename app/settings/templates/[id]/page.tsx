import Link from "next/link";
import { notFound } from "next/navigation";

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { TEMPLATE_KEY_LABELS, TEMPLATE_VARIABLES } from "@/lib/autorespond/templateDefaults";
import type { TemplateKey } from "@/lib/autorespond/templates";
import { TemplateEditor } from "@/components/dashboard/TemplateEditor";

const DEFAULT_SHOP_SLUG = "christchurch";

export default async function TemplateEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = getSupabaseAdminClient();

  const { data: shop } = await supabase
    .from("shops")
    .select("id, name")
    .eq("slug", DEFAULT_SHOP_SLUG)
    .maybeSingle();

  if (!shop) return <main className="pageShell"><p>Shop not found.</p></main>;

  const { data: template } = await supabase
    .from("lead_email_templates")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!template) notFound();

  const key = template.template_key as TemplateKey;
  const variables = TEMPLATE_VARIABLES[key] ?? [];

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
        }}
        variables={variables}
      />
    </main>
  );
}
