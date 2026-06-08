-- BUGFIX: disposition + cool-down "set_by" FKs pointed at auth.users(id),
-- but this app authenticates against public.staff_users (auth.users is
-- empty). Every disposition-chip click and every cool-down save stamped a
-- staff_users.id into these columns, violating the FK and failing the whole
-- UPDATE — so NO disposition or cool-down ever persisted and the buttons
-- silently did nothing.
--
-- Repoint both FKs to staff_users. Already applied to prod 2026-06-08 via
-- MCP; this file is the repo record.

alter table leads drop constraint if exists leads_last_disposition_by_fkey;
alter table leads drop constraint if exists leads_cooldown_set_by_fkey;

alter table leads
  add constraint leads_last_disposition_by_fkey
  foreign key (last_disposition_by) references staff_users(id) on delete set null;

alter table leads
  add constraint leads_cooldown_set_by_fkey
  foreign key (cooldown_set_by) references staff_users(id) on delete set null;
