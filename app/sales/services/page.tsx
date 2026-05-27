import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/currentShop";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

import { ServiceOfferingsClient } from "./ServiceOfferingsClient";

type ServiceOffering = {
  id: string;
  shop_id: string | null;
  service_id: string;
  display_name: string;
  category: string | null;
  popularity_rank: number | null;
  pricing_table: Record<string, { price?: number; price_from?: number; price_to?: number; duration_minutes?: number }> | null;
  description: string | null;
  what_included: string | null;
  selling_points: string | null;
  notes: string | null;
  is_active: boolean;
  updated_at: string;
};

export default async function SalesServicesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "contractor") {
    // Contractor can read but doesn't have a sales-tools nav entry; allow
    // access since the requirement is sales + contractor + admin.
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("service_offerings")
    .select("*")
    .eq("is_active", true)
    .or(`shop_id.is.null,shop_id.eq.${user.shop.id}`)
    .order("popularity_rank", { ascending: true, nullsFirst: false });

  if (error) {
    return (
      <main className="pageShell">
        <div className="pageTopbar">
          <h1 className="pageTitle">Services</h1>
        </div>
        <p className="profileEmpty">Could not load services: {error.message}</p>
      </main>
    );
  }

  const offerings = (data ?? []) as ServiceOffering[];
  const isAdmin = user.role === "admin";

  return (
    <main className="pageShell">
      <div className="pageTopbar">
        <div>
          <p className="eyebrow">Sales playbook</p>
          <h1 className="pageTitle">Services</h1>
          <p className="detailSubtitle">
            What we sell, how to pitch it, and what to charge.
          </p>
        </div>
      </div>

      <ServiceOfferingsClient offerings={offerings} canEdit={isAdmin} />
    </main>
  );
}
