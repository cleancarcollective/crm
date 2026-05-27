import { redirect } from "next/navigation";

import { MarkdownResourceEditor } from "@/components/dashboard/MarkdownResourceEditor";
import { getCurrentUser } from "@/lib/auth/currentShop";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { formatDateTime } from "@/lib/dashboard/format";

export default async function SalesScriptPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = getSupabaseAdminClient();

  // Prefer the shop-specific row if there is one, else fall back to global.
  const { data } = await supabase
    .from("sales_resources")
    .select("*")
    .eq("type", "script")
    .or(`shop_id.is.null,shop_id.eq.${user.shop.id}`)
    .order("shop_id", { ascending: false, nullsFirst: false })
    .limit(1);

  const script = data?.[0];

  if (!script) {
    return (
      <main className="pageShell">
        <div className="pageTopbar">
          <div>
            <p className="eyebrow">Sales playbook</p>
            <h1 className="pageTitle">Script</h1>
          </div>
        </div>
        <p className="profileEmpty">No script seeded yet. Ask an admin to add one.</p>
      </main>
    );
  }

  // Look up the editor name for the meta line.
  let editorName = "";
  if (script.updated_by_user_id) {
    const { data: u } = await supabase
      .from("staff_users")
      .select("name")
      .eq("id", script.updated_by_user_id)
      .maybeSingle();
    if (u?.name) editorName = ` by ${u.name as string}`;
  }
  const metaLine = `Last updated ${formatDateTime(script.updated_at, user.shop.timezone, "EEE d MMM yyyy, h:mm a")}${editorName}`;

  const canEdit = user.role === "admin" || user.role === "sales";

  return (
    <main className="pageShell">
      <div className="pageTopbar">
        <div>
          <p className="eyebrow">Sales playbook</p>
          <h1 className="pageTitle">{script.title}</h1>
          <p className="detailSubtitle">
            Working call script. Edit anytime - your changes are saved against your user.
          </p>
        </div>
      </div>

      <section className="detailPanel">
        <MarkdownResourceEditor
          resourceId={script.id}
          initialTitle={script.title}
          initialBody={script.body_markdown}
          canEdit={canEdit}
          metaLine={metaLine}
        />
      </section>
    </main>
  );
}
