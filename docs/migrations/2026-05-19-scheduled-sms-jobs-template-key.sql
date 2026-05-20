-- Bring scheduled_sms_jobs up to parity with scheduled_email_jobs:
-- adds the lead_id + template_key columns the code already expects,
-- plus partial unique indexes for upsert-based idempotency.
--
-- Applied to prod via Supabase MCP 2026-05-19. File kept in repo for
-- the migration history.

alter table scheduled_sms_jobs
  add column if not exists lead_id uuid references leads(id) on delete set null,
  add column if not exists template_key text;

create unique index if not exists scheduled_sms_jobs_booking_template_uniq
  on scheduled_sms_jobs(shop_id, booking_id, template_key)
  where booking_id is not null and template_key is not null;

create unique index if not exists scheduled_sms_jobs_lead_template_uniq
  on scheduled_sms_jobs(shop_id, lead_id, template_key)
  where lead_id is not null and template_key is not null;
