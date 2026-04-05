import type { SupabaseClient } from "@supabase/supabase-js";

import type { NormalizedContactInput } from "@/lib/bookingIntake/types";

type ContactRow = {
  id: string;
  shop_id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
  updated_at: string;
};

export async function upsertContact(
  supabase: SupabaseClient,
  shopId: string,
  contact: NormalizedContactInput
) {
  let existingContact: ContactRow | null = null;

  if (contact.normalizedEmail) {
    const { data, error } = await supabase
      .from("contacts")
      .select("*")
      .eq("shop_id", shopId)
      .ilike("email", contact.normalizedEmail)
      .maybeSingle();

    if (error) {
      throw error;
    }

    existingContact = data;
  }

  if (!existingContact && contact.normalizedPhone) {
    const { data, error } = await supabase
      .from("contacts")
      .select("*")
      .eq("shop_id", shopId)
      .eq("phone", contact.normalizedPhone)
      .maybeSingle();

    if (error) {
      throw error;
    }

    existingContact = data;
  }

  if (existingContact) {
    return existingContact;
  }

  const { data, error } = await supabase
    .from("contacts")
    .insert({
      shop_id: shopId,
      first_name: contact.firstName,
      last_name: contact.lastName,
      full_name: contact.fullName,
      email: contact.normalizedEmail,
      phone: contact.normalizedPhone
    })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data;
}
