-- Cool-down flag for sales leads.
--
-- Sales rep marks a lead as "cool down" with a reason + resurface date
-- when there's a reason not to call (out of country, just bought elsewhere,
-- waiting on insurance, etc). The lead drops off warm/cold/frozen until
-- now() passes cooldown_until, then naturally re-appears in whichever
-- age-bucket it now belongs to.
--
-- Permissions: anyone with edit-lead rights can set/clear cool-down
-- (sales + owners/admins).

alter table leads
  add column if not exists cooldown_until timestamptz,
  add column if not exists cooldown_reason text,
  add column if not exists cooldown_set_by uuid references staff_users(id) on delete set null,
  add column if not exists cooldown_set_at timestamptz;

create index if not exists leads_cooldown_until_idx on leads(cooldown_until)
  where cooldown_until is not null;

comment on column leads.cooldown_until is 'When set in the future, the lead appears on the /sales?bucket=cooldown page and is suppressed from warm/cold/frozen. Resurfaces automatically once now() passes this timestamp.';
comment on column leads.cooldown_reason is 'Free text — why we shouldn''t call this lead right now. Surfaced on the cool-down list so the next rep sees context without clicking in.';
