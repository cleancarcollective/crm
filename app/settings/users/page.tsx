import Link from "next/link";
import { redirect } from "next/navigation";

import { UsersAdmin } from "@/components/dashboard/UsersAdmin";
import { getCurrentUser } from "@/lib/auth/currentShop";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export default async function UsersSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") {
    return (
      <main className="pageShell">
        <div className="pageTopbar">
          <div>
            <p className="eyebrow"><Link href="/settings" className="eyebrowLink">← Back to Settings</Link></p>
            <h1 className="pageTitle">Users</h1>
          </div>
        </div>
        <section className="detailPanel">
          <p>You need an admin role to manage users.</p>
        </section>
      </main>
    );
  }

  const supabase = getSupabaseAdminClient();
  const { data } = await supabase
    .from("staff_users")
    .select("id, email, name, role, is_super_admin, created_at")
    .eq("shop_id", user.shop.id)
    .order("created_at", { ascending: true });

  const staff = (data ?? []).map((s: any) => ({
    id: s.id as string,
    email: s.email as string,
    name: s.name as string,
    role: (s.role as string) === "contractor" ? "contractor" : "admin",
    is_super_admin: !!s.is_super_admin,
    created_at: s.created_at as string,
    isSelf: s.id === user.userId,
  }));

  return (
    <main className="pageShell">
      <div className="pageTopbar">
        <div>
          <p className="eyebrow"><Link href="/settings" className="eyebrowLink">← Back to Settings</Link></p>
          <h1 className="pageTitle">Users</h1>
          <p className="detailSubtitle">
            {user.shop.name} · {staff.length} staff account{staff.length === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      <UsersAdmin initialStaff={staff} shopSlug={user.shop.slug} />
    </main>
  );
}
