import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/currentShop";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

import { ObjectionsClient, type SalesResource } from "./ObjectionsClient";

export default async function SalesObjectionsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = getSupabaseAdminClient();

  const { data, error } = await supabase
    .from("sales_resources")
    .select("*")
    .in("type", ["objection-card", "opener", "closing"])
    .or(`shop_id.is.null,shop_id.eq.${user.shop.id}`)
    .order("display_order", { ascending: true });

  if (error) {
    return (
      <main className="pageShell">
        <h1 className="pageTitle">Objections</h1>
        <p className="profileEmpty">Could not load: {error.message}</p>
      </main>
    );
  }

  const resources = (data ?? []) as SalesResource[];
  const canEdit = user.role === "admin" || user.role === "sales";

  return (
    <main className="pageShell">
      <div className="pageTopbar">
        <div>
          <p className="eyebrow">Sales playbook</p>
          <h1 className="pageTitle">Objections, openers, closes</h1>
          <p className="detailSubtitle">
            Click a card to read it. Refine the wording as you learn what lands on the phone.
          </p>
        </div>
      </div>

      <ObjectionsClient resources={resources} canEdit={canEdit} />
    </main>
  );
}
