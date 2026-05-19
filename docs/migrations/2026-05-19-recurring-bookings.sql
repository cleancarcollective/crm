-- =============================================================================
-- Recurring bookings, step 1.
-- Adds the `booking_series` table that holds a recurrence rule + booking
-- template, and links each `bookings` row back to its parent series so the
-- calendar can mark recurring occurrences and so future "edit just this
-- one / whole series" + "cancel just this one / whole series" dialogs can
-- distinguish overridden occurrences from clean ones.
--
-- v1 only pre-generates 12 months of occurrences on series creation. A
-- future daily cron (step 2) will use generated_through_date to advance the
-- horizon. Discount fields are unused in v1 but reserved so the customer
-- self-signup flow (future) can attach a discount to a series without
-- another migration.
-- =============================================================================

create table if not exists booking_series (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  vehicle_id uuid references vehicles(id) on delete set null,

  -- Booking template (copied to each occurrence at generation time)
  service_name text not null,
  service_details text,
  size text,
  price_estimate numeric(10,2),
  duration_minutes integer,
  location_type text,
  service_address text,
  notes text,
  booking_source text not null default 'recurring',

  -- Recurrence rule
  frequency text not null check (frequency in ('days','weeks','months_nth_weekday')),
  interval_count integer not null default 1 check (interval_count >= 1),
  -- For frequency='months_nth_weekday': which week (1-4 or -1 for last) and day (0=Sun..6=Sat)
  nth_week_of_month integer,
  day_of_week integer check (day_of_week is null or (day_of_week between 0 and 6)),

  -- First occurrence + timezone
  first_occurrence_at timestamptz not null,
  timezone text not null,

  -- End condition
  end_type text not null default 'never' check (end_type in ('never','after_n','on_date')),
  end_after_n integer,
  end_on_date date,

  -- State
  status text not null default 'active' check (status in ('active','paused','cancelled')),
  generated_through_date date,
  occurrences_generated integer not null default 0,
  last_regen_at timestamptz,
  last_regen_error text,

  -- Future discount tracking (unused in v1)
  discount_percent numeric(5,2),
  discount_source text,
  series_source text not null default 'staff_manual',

  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists booking_series_shop_idx on booking_series(shop_id);
create index if not exists booking_series_contact_idx on booking_series(contact_id);
create index if not exists booking_series_status_idx on booking_series(status);
-- Partial index used by the future cron to find active series due for regen.
create index if not exists booking_series_regen_idx on booking_series(status, generated_through_date)
  where status = 'active';

alter table bookings
  add column if not exists series_id uuid references booking_series(id) on delete set null,
  add column if not exists series_sequence integer,
  add column if not exists series_overridden boolean not null default false;

create index if not exists bookings_series_idx on bookings(series_id, series_sequence);

-- Reuses the existing set_updated_at() function defined in schema.sql.
drop trigger if exists booking_series_set_updated_at on booking_series;
create trigger booking_series_set_updated_at
  before update on booking_series
  for each row execute function set_updated_at();
