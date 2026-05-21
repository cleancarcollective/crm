-- =============================================================================
-- Sales role addition.
--
-- Adds a third staff role ('sales') with tight permissions: see and call
-- cold leads, take notes, and book customers (one-call close). No access to
-- settings, analytics, costs, or customer profiles outside lead context.
--
-- A sales user is scoped to ONE shop via assigned_shop_id (separate from
-- shop_id, which is their home/login shop). For the initial rollout these
-- are normally the same value, but keeping the column distinct lets us
-- assign a sales rep to a shop other than the one their staff_user row
-- lives under if we ever need to.
--
-- Bookings created by sales reps are attributed via bookings.booked_by_user_id
-- so we can measure conversion per rep.
-- =============================================================================

-- 1. Relax the role check to include 'sales'.
alter table staff_users
  drop constraint if exists staff_users_role_check;

alter table staff_users
  add constraint staff_users_role_check
  check (role in ('admin', 'contractor', 'sales'));

-- 2. assigned_shop_id — which shop's leads can this user see.
--    For non-sales users this column is nullable + ignored; for sales users
--    it's required (enforced in the API, not the DB, since back-filling
--    historical rows would be a pain).
--
--    NOTE 2026-05-21: this originally had `references shops(id) on delete
--    set null` but that created a SECOND FK from staff_users to shops,
--    making PostgREST's embedded `shop:shops(...)` select ambiguous and
--    crashing every authenticated page in production. FK was dropped via
--    `alter table staff_users drop constraint staff_users_assigned_shop_id_fkey`
--    and the session loader now looks up the assigned shop with a separate
--    PK query. Column stays for the data; no FK is needed.
alter table staff_users
  add column if not exists assigned_shop_id uuid;

create index if not exists staff_users_assigned_shop_id_idx
  on staff_users(assigned_shop_id);

-- 3. bookings.booked_by_user_id — staff who created the booking, when known.
--    Already populated implicitly via session for new sales-rep bookings; old
--    rows stay null.
alter table bookings
  add column if not exists booked_by_user_id uuid references staff_users(id) on delete set null;

create index if not exists bookings_booked_by_user_id_idx
  on bookings(booked_by_user_id);
