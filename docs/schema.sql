create extension if not exists pgcrypto;

create table if not exists shops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  timezone text not null default 'Pacific/Auckland',
  created_at timestamptz not null default now()
);

create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  first_name text,
  last_name text,
  full_name text,
  email text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists vehicles (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  make text,
  model text,
  year text,
  rego text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  vehicle_id uuid references vehicles(id) on delete set null,
  source text not null,
  source_detail text,
  service_requested text,
  notes text,
  status text not null default 'new' check (status in ('new','contacted','quoted','clicked','booked','lost')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  booked_at timestamptz
);

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  vehicle_id uuid references vehicles(id) on delete set null,
  lead_id uuid references leads(id) on delete set null,
  booking_source text not null,
  service_name text not null,
  service_details text,
  scheduled_start timestamptz not null,
  scheduled_end timestamptz,
  status text not null default 'pending' check (status in ('pending','confirmed','reminder_sent','completed','cancelled','no_show')),
  price_estimate numeric(10,2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists email_templates (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  key text not null,
  name text not null,
  subject_template text not null,
  body_template text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(shop_id, key)
);

create table if not exists email_messages (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  lead_id uuid references leads(id) on delete set null,
  booking_id uuid references bookings(id) on delete set null,
  template_id uuid references email_templates(id) on delete set null,
  provider_message_id text,
  subject text not null,
  body_rendered text not null,
  status text not null default 'queued',
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists email_events (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  email_message_id uuid not null references email_messages(id) on delete cascade,
  event_type text not null,
  event_timestamp timestamptz not null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists scheduled_email_jobs (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  booking_id uuid references bookings(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  template_key text not null,
  scheduled_for timestamptz not null,
  status text not null default 'pending' check (status in ('pending','processing','sent','cancelled','failed','skipped')),
  email_message_id uuid references email_messages(id) on delete set null,
  attempt_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, booking_id, template_key)
);

create index if not exists contacts_shop_id_idx on contacts(shop_id);
create index if not exists contacts_email_idx on contacts(email);
create index if not exists contacts_phone_idx on contacts(phone);

create index if not exists vehicles_shop_id_idx on vehicles(shop_id);
create index if not exists vehicles_contact_id_idx on vehicles(contact_id);
create index if not exists vehicles_rego_idx on vehicles(rego);

create index if not exists leads_shop_id_idx on leads(shop_id);
create index if not exists leads_contact_id_idx on leads(contact_id);
create index if not exists leads_status_idx on leads(status);
create index if not exists leads_source_idx on leads(source);

create index if not exists bookings_shop_id_idx on bookings(shop_id);
create index if not exists bookings_contact_id_idx on bookings(contact_id);
create index if not exists bookings_vehicle_id_idx on bookings(vehicle_id);
create index if not exists bookings_lead_id_idx on bookings(lead_id);
create index if not exists bookings_status_idx on bookings(status);
create index if not exists bookings_scheduled_start_idx on bookings(scheduled_start);

create index if not exists email_messages_shop_id_idx on email_messages(shop_id);
create index if not exists email_messages_booking_id_idx on email_messages(booking_id);
create index if not exists email_messages_provider_message_id_idx on email_messages(provider_message_id);

create index if not exists email_events_shop_id_idx on email_events(shop_id);
create index if not exists email_events_message_id_idx on email_events(email_message_id);
create index if not exists email_events_type_idx on email_events(event_type);

create index if not exists scheduled_email_jobs_shop_id_idx on scheduled_email_jobs(shop_id);
create index if not exists scheduled_email_jobs_booking_id_idx on scheduled_email_jobs(booking_id);
create index if not exists scheduled_email_jobs_status_idx on scheduled_email_jobs(status);
create index if not exists scheduled_email_jobs_scheduled_for_idx on scheduled_email_jobs(scheduled_for);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists contacts_set_updated_at on contacts;
create trigger contacts_set_updated_at
before update on contacts
for each row execute function set_updated_at();

drop trigger if exists vehicles_set_updated_at on vehicles;
create trigger vehicles_set_updated_at
before update on vehicles
for each row execute function set_updated_at();

drop trigger if exists leads_set_updated_at on leads;
create trigger leads_set_updated_at
before update on leads
for each row execute function set_updated_at();

drop trigger if exists bookings_set_updated_at on bookings;
create trigger bookings_set_updated_at
before update on bookings
for each row execute function set_updated_at();

drop trigger if exists email_templates_set_updated_at on email_templates;
create trigger email_templates_set_updated_at
before update on email_templates
for each row execute function set_updated_at();

drop trigger if exists scheduled_email_jobs_set_updated_at on scheduled_email_jobs;
create trigger scheduled_email_jobs_set_updated_at
before update on scheduled_email_jobs
for each row execute function set_updated_at();

insert into shops (name, slug, timezone)
values ('Clean Car Collective Christchurch', 'christchurch', 'Pacific/Auckland')
on conflict (slug) do nothing;

insert into email_templates (
  shop_id,
  key,
  name,
  subject_template,
  body_template,
  is_active
)
select
  shops.id,
  'booking-confirmation',
  'Booking Confirmation',
  'Booking confirmed for {{service_name}} on {{scheduled_date}}',
  E'Hi {{first_name}},\n\nYour booking with Clean Car Collective Christchurch is confirmed.\n\nService: {{service_name}}\nDate: {{scheduled_date}}\nTime: {{scheduled_time}}\nVehicle: {{vehicle_label}}\nLocation: {{location_type}}\nEstimated price: {{price_estimate}}\n\nNotes:\n{{notes}}\n\nIf you need to make any changes, reply to this email.\n\nClean Car Collective Christchurch',
  true
from shops
where shops.slug = 'christchurch'
on conflict (shop_id, key) do nothing;

insert into email_templates (
  shop_id,
  key,
  name,
  subject_template,
  body_template,
  is_active
)
select
  shops.id,
  'booking-reminder',
  'Booking Reminder',
  'Reminder: {{service_name}} on {{scheduled_date}} at {{scheduled_time}}',
  E'Hi {{first_name}},\n\nThis is a reminder about your upcoming booking with Clean Car Collective Christchurch.\n\nService: {{service_name}}\nDate: {{scheduled_date}}\nTime: {{scheduled_time}}\nVehicle: {{vehicle_label}}\nLocation: {{location_type}}\nEstimated price: {{price_estimate}}\n\nNotes:\n{{notes}}\n\nIf anything has changed, reply to this email.\n\nClean Car Collective Christchurch',
  true
from shops
where shops.slug = 'christchurch'
on conflict (shop_id, key) do nothing;

insert into email_templates (
  shop_id,
  key,
  name,
  subject_template,
  body_template,
  is_active
)
select
  shops.id,
  'booking-team-notification',
  'New Booking Team Notification',
  'New booking: {{service_name}} on {{scheduled_date}} at {{scheduled_time}}',
  E'Hi {{first_name}},\n\nA new booking has been created in the CRM.\n\nService: {{service_name}}\nDate: {{scheduled_date}}\nTime: {{scheduled_time}}\nVehicle: {{vehicle_label}}\nLocation: {{location_type}}\nEstimated price: {{price_estimate}}\n\nNotes:\n{{notes}}\n\nReview this booking in the CRM calendar if any prep or follow-up is required.\n\n{{shop_name}}',
  true
from shops
where shops.slug = 'christchurch'
on conflict (shop_id, key) do nothing;

insert into email_templates (
  shop_id,
  key,
  name,
  subject_template,
  body_template,
  is_active
)
select
  shops.id,
  'booking-reminder-week',
  'Booking Reminder - One Week',
  'Reminder: {{service_name}} in one week on {{scheduled_date}}',
  E'Hi {{first_name}},\n\nThis is your one-week reminder for your upcoming booking with Clean Car Collective Christchurch.\n\nService: {{service_name}}\nDate: {{scheduled_date}}\nTime: {{scheduled_time}}\nVehicle: {{vehicle_label}}\nLocation: {{location_type}}\nEstimated price: {{price_estimate}}\n\nNotes:\n{{notes}}\n\nIf anything has changed, reply to this email.\n\n{{shop_name}}',
  true
from shops
where shops.slug = 'christchurch'
on conflict (shop_id, key) do nothing;

insert into email_templates (
  shop_id,
  key,
  name,
  subject_template,
  body_template,
  is_active
)
select
  shops.id,
  'booking-reminder-day',
  'Booking Reminder - One Day',
  'Reminder: {{service_name}} tomorrow at {{scheduled_time}}',
  E'Hi {{first_name}},\n\nThis is your one-day reminder for your upcoming booking with Clean Car Collective Christchurch.\n\nService: {{service_name}}\nDate: {{scheduled_date}}\nTime: {{scheduled_time}}\nVehicle: {{vehicle_label}}\nLocation: {{location_type}}\nEstimated price: {{price_estimate}}\n\nNotes:\n{{notes}}\n\nIf anything has changed, reply to this email.\n\n{{shop_name}}',
  true
from shops
where shops.slug = 'christchurch'
on conflict (shop_id, key) do nothing;

insert into email_templates (
  shop_id,
  key,
  name,
  subject_template,
  body_template,
  is_active
)
select
  shops.id,
  'booking-reminder-hour',
  'Booking Reminder - One Hour',
  'Reminder: {{service_name}} starts in one hour',
  E'Hi {{first_name}},\n\nThis is your one-hour reminder for your upcoming booking with Clean Car Collective Christchurch.\n\nService: {{service_name}}\nDate: {{scheduled_date}}\nTime: {{scheduled_time}}\nVehicle: {{vehicle_label}}\nLocation: {{location_type}}\nEstimated price: {{price_estimate}}\n\nNotes:\n{{notes}}\n\nWe look forward to seeing you shortly.\n\n{{shop_name}}',
  true
from shops
where shops.slug = 'christchurch'
on conflict (shop_id, key) do nothing;

insert into email_templates (
  shop_id,
  key,
  name,
  subject_template,
  body_template,
  is_active
)
select
  shops.id,
  'booking-update',
  'Booking Update',
  'Updated booking: {{service_name}} on {{scheduled_date}}',
  E'Hi {{first_name}},\n\nThere has been an update to your booking with Clean Car Collective Christchurch.\n\nService: {{service_name}}\nDate: {{scheduled_date}}\nTime: {{scheduled_time}}\nVehicle: {{vehicle_label}}\nLocation: {{location_type}}\nEstimated price: {{price_estimate}}\n\nNotes:\n{{notes}}\n\nIf you have any questions, reply to this email.\n\nClean Car Collective Christchurch',
  true
from shops
where shops.slug = 'christchurch'
on conflict (shop_id, key) do nothing;

alter table vehicles
add column if not exists size text;

alter table bookings
add column if not exists service_id text,
add column if not exists duration_minutes integer,
add column if not exists location_type text,
add column if not exists raw_payload jsonb not null default '{}'::jsonb;
