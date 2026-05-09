-- =============================================================================
-- sms_templates table — per-shop editable copies of the SMS bodies we send
-- =============================================================================
-- Mirrors email_templates: same shop_id scoping, same upsert pattern.
-- The renderer (lib/sms/smsTemplateRenderer.ts) falls back to code defaults
-- in lib/sms/smsTemplateDefaults.ts when a row is missing — so SMS delivery
-- never fails on template lookup, but staff get the ability to override the
-- copy per shop.
--
-- Run this in the Supabase SQL editor against production.
-- Idempotent: safe to re-run.
-- =============================================================================

create table if not exists sms_templates (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  template_key text not null,
  name text not null,
  body_text text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(shop_id, template_key)
);

create index if not exists sms_templates_shop_id_idx on sms_templates(shop_id);

-- updated_at auto-bump trigger (mirrors what other tables do)
create or replace function set_sms_templates_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists sms_templates_set_updated_at on sms_templates;
create trigger sms_templates_set_updated_at
  before update on sms_templates
  for each row execute function set_sms_templates_updated_at();

-- =============================================================================
-- Seed both shops with the 6 default templates (from
-- lib/sms/smsTemplateDefaults.ts). On conflict, do nothing — so re-running
-- never overwrites edits made via the admin UI.
-- =============================================================================

insert into sms_templates (shop_id, template_key, name, body_text, is_active)
select s.id, t.template_key, t.name, t.body_text, true
from shops s
cross join (values
  (
    'booking_confirmation',
    'Booking confirmation',
    'Hi {{name}}, your booking is confirmed for {{date_time}}. See you soon! - Clean Car Collective'
  ),
  (
    'booking_reminder_day',
    'Booking reminder — 1 day before',
    'Hi {{name}}, friendly reminder - your Clean Car Collective booking is tomorrow, {{date_time}}. Reply if anything''s changed. See you soon!'
  ),
  (
    'pickup_normal',
    'Pickup ready — during opening hours',
    'Hi {{name}}, {{vehicle}} is ready for pick-up! If you''ll be more than 30 minutes away, please give us a heads-up. - Clean Car Collective'
  ),
  (
    'pickup_after_hours',
    'Pickup ready — after hours',
    'Hi {{name}}, {{vehicle}} is ready for pick-up! We close at 5:00 pm — if you''ll be more than 30 mins away please let us know your ETA. - Clean Car Collective'
  ),
  (
    'review_request',
    'Review request — 23h after pickup',
    'Hey {{name}}, thanks again for choosing Clean Car Collective! We''d love your quick feedback - just tap here: https://cleancarcollective.co.nz/how-did-we-do/'
  ),
  (
    'lead_followup_5day',
    'Lead follow-up SMS — 5 days after estimate',
    'Hi {{name}}, just checking - any questions about the {{vehicle}} detailing estimate? Happy to chat or lock in a slot: cleancarcollective.co.nz/make-a-booking - {{senderName}}'
  )
) as t(template_key, name, body_text)
on conflict (shop_id, template_key) do nothing;
