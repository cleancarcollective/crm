import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const SESSION_COOKIE = "crm_session";
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

export async function verifySession(sessionId: string): Promise<SessionUser | null> {
  if (!sessionId) return null;
  const supabase = getSupabaseAdminClient();

  // Pull session → user → user's shop in one query
  const { data, error } = await supabase
    .from("staff_sessions")
    .select(
      "user_id, expires_at, staff_users(id, email, name, shop_id, shop:shops(id, slug, name, timezone))"
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
        shop_id: string;
        shop: { id: string; slug: string; name: string; timezone: string } | null;
      }
    | null;

  if (!user || !user.shop) return null;

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    shop: {
      id: user.shop.id,
      slug: user.shop.slug,
      name: user.shop.name,
      timezone: user.shop.timezone,
    },
  };
}

export async function deleteSession(sessionId: string): Promise<void> {
  const supabase = getSupabaseAdminClient();
  await supabase.from("staff_sessions").delete().eq("id", sessionId);
}
