-- Sales call disposition on leads.
--
-- Sales reps pick one of 7 chips after a call: neutral, positive, confirmed,
-- malfunction, lost, cooldown, booked. The chip drives the list-view column
-- on /sales (replacing Days/Touched/Status for sales role) AND the detail
-- page's quick-action row (replacing Called/Callback/Booked/Not interested).
--
-- Status mapping (set as a side-effect by the UI, not by trigger):
--   neutral / positive / malfunction → status=contacted
--   confirmed                        → status=quoted
--   lost                             → status=lost
--   booked                           → status=won (+booked_at, optional booking)
--   cooldown                         → no status change; cooldown_until is set
--
-- We track the disposition independently so we can change the status mapping
-- later without losing the rep's per-call signal.

alter table leads
  add column if not exists last_disposition text,
  add column if not exists last_disposition_at timestamptz,
  add column if not exists last_disposition_by uuid references staff_users(id) on delete set null;

create index if not exists leads_last_disposition_idx on leads(last_disposition)
  where last_disposition is not null;

comment on column leads.last_disposition is 'Most recent call outcome chip picked by sales. One of: neutral, positive, confirmed, malfunction, lost, cooldown, booked.';
