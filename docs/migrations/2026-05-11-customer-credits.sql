-- =============================================================================
-- customer_credits — owed services / vouchers per customer
-- =============================================================================
-- Used for promo codes like CCC5 that grant a free service the customer
-- can redeem on a future booking, gift vouchers, "make-good" credits after
-- a complaint, etc. One row per outstanding credit; flip redeemed=true (with
-- redeemed_booking_id) when the customer uses it.
--
-- Idempotent. Run in the Supabase SQL editor.
-- =============================================================================

create table if not exists customer_credits (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  /** What kind of credit (free service, dollar discount, etc.). Currently
      only 'free_service' is used; left open for future types. */
  credit_type text not null default 'free_service',
  /** Human-readable service name they're owed, matching pricing.service_name
      so we can quote at redemption time. e.g. 'Deluxe Exterior Detail'. */
  service_name text not null,
  /** Free-text notes shown on the contact profile + booking detail. */
  description text,
  /** Where the credit came from. e.g. 'promo_code:CCC5', 'manual:apology',
      'voucher:gift'. */
  source text not null,
  /** Booking that triggered the credit (if any). */
  source_booking_id uuid references bookings(id) on delete set null,
  /** Set when the customer redeems the credit on a future booking. */
  redeemed boolean not null default false,
  redeemed_booking_id uuid references bookings(id) on delete set null,
  redeemed_at timestamptz,
  /** Optional expiry — null = never. */
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customer_credits_contact_idx
  on customer_credits (contact_id, redeemed)
  where redeemed = false;

create index if not exists customer_credits_shop_idx
  on customer_credits (shop_id, redeemed)
  where redeemed = false;

create or replace function set_customer_credits_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists customer_credits_set_updated_at on customer_credits;
create trigger customer_credits_set_updated_at
  before update on customer_credits
  for each row execute function set_customer_credits_updated_at();
