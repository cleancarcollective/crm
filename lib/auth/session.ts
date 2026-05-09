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

export type SessionUser = {
  userId: string;
  email: string;
  name: string;
  /** True if this user can switch between shops via the nav. */
  isSuperAdmin: boolean;
  /** The shop the user belongs to (their permanent home). */
  homeShop: SessionShop;
  /**
   * The shop the request is currently operating on. For non-super-admins,
   * always equal to homeShop. For super-admins, equal to the shop they've
   * selected via the active-shop cookie (defaulting to homeShop if unset).
   */
  shop: SessionShop;
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
      "user_id, expires_at, staff_users(id, email, name, is_super_admin, shop_id, shop:shops(id, slug, name, timezone))"
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
        shop_id: string;
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

  // Resolve effective shop. Non-super-admins always use their home shop —
  // any active-shop cookie they have is silently ignored. Super-admins can
  // override via the cookie; on bad slug we silently fall back to home.
  let effectiveShop = homeShop;
  const isSuperAdmin = user.is_super_admin === true;
  if (isSuperAdmin && activeShopSlug && activeShopSlug !== homeShop.slug) {
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
    homeShop,
    shop: effectiveShop,
  };
}

export async function deleteSession(sessionId: string): Promise<void> {
  const supabase = getSupabaseAdminClient();
  await supabase.from("staff_sessions").delete().eq("id", sessionId);
}
