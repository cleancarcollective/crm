import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const SESSION_COOKIE = "crm_session";
export const ACTIVE_SHOP_COOKIE = "crm_active_shop";
const SESSION_DAYS = 30;

export type SessionShop = {
  id: string;
  slug: string;
  name: string;
  timezone: string;
};

export type StaffRole = "admin" | "contractor" | "sales";

export type SessionUser = {
  userId: string;
  email: string;
  name: string;
  /** True if this user can switch between shops via the nav. */
  isSuperAdmin: boolean;
  /** Permissions tier. "admin" = full access. "contractor" = read-only view
   *  of bookings/calendar/contacts; no settings, analytics, or staff admin.
   *  "sales" = cold-lead caller; only sees /sales + a locked-down lead
   *  detail view + the booking modal. */
  role: StaffRole;
  /** The shop the user belongs to (their permanent home). */
  homeShop: SessionShop;
  /**
   * The shop the request is currently operating on. For non-super-admins,
   * always equal to homeShop. For super-admins, equal to the shop they've
   * selected via the active-shop cookie (defaulting to homeShop if unset).
   * For sales users, equal to their assigned_shop (see below) — the
   * active-shop cookie is ignored.
   */
  shop: SessionShop;
  /**
   * Sales users are pinned to one shop's lead queue regardless of which
   * shop they "belong" to. Null for admin/contractor. The shop scope is
   * enforced server-side via this field (NOT via the active-shop cookie).
   */
  assignedShop: SessionShop | null;
};

export async function createSession(userId: string): Promise<string> {
  const supabase = getSupabaseAdminClient();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_DAYS);

  const { data, error } = await supabase
    .from("staff_sessions")
    .insert({ user_id: userId, expires_at: expiresAt.toISOString() })
    .select("id")
    .single();

  if (error || !data) throw new Error("Failed to create session");
  return data.id as string;
}

/**
 * Verify a session cookie and resolve the effective shop.
 *
 * @param sessionId - the value of the SESSION_COOKIE
 * @param activeShopSlug - optional slug from ACTIVE_SHOP_COOKIE; only respected
 *   when the user has is_super_admin = true. Pass null/undefined to use the
 *   user's home shop.
 */
export async function verifySession(
  sessionId: string,
  activeShopSlug?: string | null
): Promise<SessionUser | null> {
  if (!sessionId) return null;
  const supabase = getSupabaseAdminClient();

  const { data, error } = await supabase
    .from("staff_sessions")
    .select(
      "user_id, expires_at, staff_users(id, email, name, is_super_admin, role, shop_id, assigned_shop_id, shop:shops(id, slug, name, timezone))"
    )
    .eq("id", sessionId)
    .maybeSingle();

  if (error || !data) return null;

  if (new Date(data.expires_at as string) < new Date()) {
    await supabase.from("staff_sessions").delete().eq("id", sessionId);
    return null;
  }

  const user = data.staff_users as unknown as
    | {
        id: string;
        email: string;
        name: string;
        is_super_admin: boolean | null;
        role: string | null;
        shop_id: string;
        assigned_shop_id: string | null;
        shop: { id: string; slug: string; name: string; timezone: string } | null;
      }
    | null;

  if (!user || !user.shop) return null;

  const homeShop: SessionShop = {
    id: user.shop.id,
    slug: user.shop.slug,
    name: user.shop.name,
    timezone: user.shop.timezone,
  };

  // Look up the assigned shop separately - the multi-FK embed broke
  // prod on 2026-05-21, and a separate lookup is cheap (1 indexed PK row)
  // + only runs for sales users since other roles leave the column null.
  let assignedShop: SessionShop | null = null;
  if (user.assigned_shop_id) {
    const { data: r } = await supabase
      .from("shops")
      .select("id, slug, name, timezone")
      .eq("id", user.assigned_shop_id)
      .maybeSingle();
    if (r) {
      assignedShop = {
        id: r.id as string,
        slug: r.slug as string,
        name: r.name as string,
        timezone: r.timezone as string,
      };
    }
  }

  const role: StaffRole =
    user.role === "contractor"
      ? "contractor"
      : user.role === "sales"
      ? "sales"
      : "admin";

  // Resolve effective shop:
  //   - sales users: pinned to assigned_shop (fall back to home if unset, which
  //     should not happen — but better safe than data-leak across shops)
  //   - super-admins: honour the active-shop cookie
  //   - everyone else: home shop
  let effectiveShop = homeShop;
  const isSuperAdmin = user.is_super_admin === true;
  if (role === "sales") {
    effectiveShop = assignedShop ?? homeShop;
  } else if (isSuperAdmin && activeShopSlug && activeShopSlug !== homeShop.slug) {
    const { data: altShop } = await supabase
      .from("shops")
      .select("id, slug, name, timezone")
      .eq("slug", activeShopSlug)
      .maybeSingle();
    if (altShop) {
      effectiveShop = {
        id: altShop.id as string,
        slug: altShop.slug as string,
        name: altShop.name as string,
        timezone: altShop.timezone as string,
      };
    }
  }

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    isSuperAdmin,
    role,
    homeShop,
    shop: effectiveShop,
    assignedShop,
  };
}

export async function deleteSession(sessionId: string): Promise<void> {
  const supabase = getSupabaseAdminClient();
  await supabase.from("staff_sessions").delete().eq("id", sessionId);
}
