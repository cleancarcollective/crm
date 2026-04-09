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
};

const SHOP_CONTACTS: Record<string, ShopContactDetails> = {
  christchurch: {
    team_email: "info@cleancarcollective.co.nz",
    reply_email: "info@cleancarcollective.co.nz",
    phone: "0221537335",
    website: "https://cleancarcollective.co.nz/christchurch",
  },
  wellington: {
    team_email: "hello@cleancarcollective.co.nz",
    reply_email: "hello@cleancarcollective.co.nz",
    phone: "0800 476 667",
    website: "https://cleancarcollective.co.nz",
  },
};

const DEFAULT_SHOP_CONTACTS: ShopContactDetails = {
  team_email: "info@cleancarcollective.co.nz",
  reply_email: "info@cleancarcollective.co.nz",
  phone: "0221537335",
  website: "https://cleancarcollective.co.nz/christchurch",
};

export function getShopContacts(shop: ShopRecord): ShopContactDetails {
  return SHOP_CONTACTS[shop.slug] ?? DEFAULT_SHOP_CONTACTS;
}
