import { redirect } from "next/navigation";

import { MarkdownResourceEditor } from "@/components/dashboard/MarkdownResourceEditor";
import { getCurrentUser } from "@/lib/auth/currentShop";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { formatDateTime } from "@/lib/dashboard/format";

/**
 * Call scripts page. Renders every type='script' resource (general cold
 * call, reactivation - recent customers, reactivation - enquiry-only,
 * etc.) as its own editable section, ordered by display_order.
 */
export default async function SalesScriptPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = getSupabaseAdminClient();

  // All script-type resources visible to this shop (global + shop-specific).
  const { data } = await supabase
    .from("sales_resources")
    .select("*")
    .eq("type", "script")
    .or(`shop_id.is.null,shop_id.eq.${user.shop.id}`)
    .order("display_order", { ascending: true })
    .order("shop_id", { ascending: false, nullsFirst: false });

  const scripts = data ?? [];
  const canEdit = user.role === "admin" || user.role === "sales";

  // Resolve editor names in one pass for the meta lines.
  const editorIds = Array.from(
    new Set(scripts.map((s) => s.updated_by_user_id).filter(Boolean) as string[])
  );
  const editorNames = new Map<string, string>();
  if (editorIds.length > 0) {
    const { data: us } = await supabase
      .from("staff_users")
      .select("id, name")
      .in("id", editorIds);
    for (const u of us ?? []) editorNames.set(u.id as string, u.name as string);
  }

  return (
    <main className="pageShell">
      <div className="pageTopbar">
        <div>
          <p className="eyebrow">Sales playbook</p>
          <h1 className="pageTitle">Call scripts</h1>
          <p className="detailSubtitle">
            Cold-call openers + reactivation scripts. Edit anytime - your changes are saved against your user.
          </p>
        </div>
      </div>

      {scripts.length === 0 ? (
        <p className="profileEmpty">No scripts seeded yet. Ask an admin to add one.</p>
      ) : (
        scripts.map((script) => {
          const editorName = script.updated_by_user_id
            ? editorNames.get(script.updated_by_user_id as string)
            : undefined;
          const metaLine = `Last updated ${formatDateTime(
            script.updated_at,
            user.shop.timezone,
            "EEE d MMM yyyy, h:mm a"
          )}${editorName ? ` by ${editorName}` : ""}`;
          return (
            <section className="detailPanel settingsSection" key={script.id}>
              <h2>{script.title}</h2>
              <MarkdownResourceEditor
                resourceId={script.id}
                initialTitle={script.title}
                initialBody={script.body_markdown}
                canEdit={canEdit}
                metaLine={metaLine}
              />
            </section>
          );
        })
      )}
    </main>
  );
}
