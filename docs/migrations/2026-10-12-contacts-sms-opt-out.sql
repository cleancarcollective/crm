-- Customer-level SMS marketing opt-out.
--
-- Prompted by a customer (10 Oct 2026) asking to come off the texting list.
-- There was no opt-out field and no consent check in the SMS send path, so
-- "taking someone off the list" had nothing to flip.
--
-- Transactional texts tied to a booking the customer made (day-before
-- reminder, car-ready pickup, review request, mid-detail upsell) still send.
-- Marketing texts (post-detail recurring-plan drips, lead nurture) are
-- suppressed by lib/sms/scheduledSmsJobs.ts via lib/sms/consent.ts.
--
-- NOT YET APPLIED TO PROD as of this commit: the Supabase MCP denied DDL and
-- no DB password is held locally. Run in the Supabase SQL editor. Until then
-- lib/sms/consent.ts carries a fallback register so opt-outs are honoured.

alter table contacts
  add column if not exists sms_opt_out boolean not null default false,
  add column if not exists sms_opt_out_at timestamptz,
  add column if not exists sms_opt_out_reason text;

create index if not exists contacts_sms_opt_out_idx on contacts (shop_id) where sms_opt_out;
