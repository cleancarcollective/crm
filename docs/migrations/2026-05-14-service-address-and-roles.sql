-- =============================================================================
-- Two unrelated additions bundled together for one round-trip in Supabase:
--   1. bookings.service_address — for mobile jobs the team needs the actual
--      pickup/service address per booking (a customer may have us at home
--      one day, at work the next).
--   2. staff_users.role — minimal role distinction so part-time contractors
--      can be onboarded without giving them admin access to settings or
--      analytics. Default 'admin' keeps existing accounts unchanged.
-- =============================================================================

alter table bookings
  add column if not exists service_address text;

alter table staff_users
  add column if not exists role text not null default 'admin'
  check (role in ('admin', 'contractor'));
