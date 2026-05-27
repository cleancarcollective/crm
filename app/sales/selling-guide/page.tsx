import { redirect } from "next/navigation";

import { MarkdownResourceEditor } from "@/components/dashboard/MarkdownResourceEditor";
import { getCurrentUser } from "@/lib/auth/currentShop";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { formatDateTime } from "@/lib/dashboard/format";

/**
 * Selling Guide — long-form reference for service differentiators,
 * upsells, qualifying questions, and transitions between services.
 * Distinct from /sales/script (the call opener + flow) — this is the
 * "while you're on a call, what do I say about Premium vs Deluxe"
 * lookup. Editable by sales reps so the on-the-ground learnings get
 * captured.
 */
export default async function SellingGuidePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = getSupabaseAdminClient();
  const { data } = await supabase
    .from("sales_resources")
    .select("*")
    .eq("type", "guide")
    .or(`shop_id.is.null,shop_id.eq.${user.shop.id}`)
    .order("shop_id", { ascending: false, nullsFirst: false })
    .limit(1);

  const guide = data?.[0];

  if (!guide) {
    return (
      <main className="pageShell">
        <div className="pageTopbar">
          <div>
            <p className="eyebrow">Sales playbook</p>
            <h1 className="pageTitle">Selling Guide</h1>
          </div>
        </div>
        <p className="profileEmpty">No selling guide seeded yet. Ask an admin to add one.</p>
      </main>
    );
  }

  let editorName = "";
  if (guide.updated_by_user_id) {
    const { data: u } = await supabase
      .from("staff_users")
      .select("name")
      .eq("id", guide.updated_by_user_id)
      .maybeSingle();
    if (u?.name) editorName = ` by ${u.name as string}`;
  }
  const metaLine = `Last updated ${formatDateTime(guide.updated_at, user.shop.timezone, "EEE d MMM yyyy, h:mm a")}${editorName}`;
  const canEdit = user.role === "admin" || user.role === "sales";

  return (
    <main className="pageShell">
      <div className="pageTopbar">
        <div>
          <p className="eyebrow">Sales playbook</p>
          <h1 className="pageTitle">{guide.title}</h1>
          <p className="detailSubtitle">
            How to position each service, qualifying questions, and upsell triggers. Edit anytime - your changes are saved against your user.
          </p>
        </div>
      </div>

      <section className="detailPanel">
        <MarkdownResourceEditor
          resourceId={guide.id}
          initialTitle={guide.title}
          initialBody={guide.body_markdown}
          canEdit={canEdit}
          metaLine={metaLine}
        />
      </section>
    </main>
  );
}
