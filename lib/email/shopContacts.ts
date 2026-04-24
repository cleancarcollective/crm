/**
 * Per-shop contact details used in outbound emails.
 * - team_email: where team notification emails (new booking, new lead) are sent TO
 * - reply_email: shown in email footers as the customer-facing contact address
 * - phone: shown in email footers
 * - website: URL used in email footer links
 */

import type { ShopRecord } from "@/lib/dashboard/types";

type ShopContactDetails = {
  team_email: string;
  reply_email: string;
  phone: string;
  website: string;
  /** First name used in email signatures + Postmark "From" display name */
  sender_name: string;
  /** Full Postmark From line — e.g. `Ben from Clean Car Collective <max@cleancarcollective.co.nz>` */
  from_line: string;
};

const SHOP_CONTACTS: Record<string, ShopContactDetails> = {
  christchurch: {
    team_email: "info@cleancarcollective.co.nz",
    reply_email: "info@cleancarcollective.co.nz",
    phone: "0221537335",
    website: "https://cleancarcollective.co.nz/christchurch",
    sender_name: "Ben",
    from_line: "Ben from Clean Car Collective <max@cleancarcollective.co.nz>",
  },
  wellington: {
    team_email: "hello@cleancarcollective.co.nz",
    reply_email: "hello@cleancarcollective.co.nz",
    phone: "0800 476 667",
    website: "https://cleancarcollective.co.nz",
    sender_name: "Max",
    from_line: "Max from Clean Car Collective <max@cleancarcollective.co.nz>",
  },
};

const DEFAULT_SHOP_CONTACTS: ShopContactDetails = {
  team_email: "info@cleancarcollective.co.nz",
  reply_email: "info@cleancarcollective.co.nz",
  phone: "0221537335",
  website: "https://cleancarcollective.co.nz/christchurch",
  sender_name: "Ben",
  from_line: "Ben from Clean Car Collective <max@cleancarcollective.co.nz>",
};

export function getShopContacts(shop: ShopRecord): ShopContactDetails {
  return SHOP_CONTACTS[shop.slug] ?? DEFAULT_SHOP_CONTACTS;
}

/**
 * Look up per-shop contact details by shop id. Used in places where we
 * only have the shop id (e.g. the auto-respond send path) and don't
 * want to plumb the slug through every arg.
 */
export async function getShopContactsById(shopId: string): Promise<ShopContactDetails> {
  const { getSupabaseAdminClient } = await import("@/lib/supabaseAdmin");
  const supabase = getSupabaseAdminClient();
  const { data } = await supabase.from("shops").select("slug").eq("id", shopId).maybeSingle();
  const slug = data?.slug;
  return (slug && SHOP_CONTACTS[slug]) || DEFAULT_SHOP_CONTACTS;
}
