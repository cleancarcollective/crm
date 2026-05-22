-- =============================================================================
-- Lead-notes authorship log.
--
-- The leads.notes column is a single overwritten text field, which means it
-- can't answer "which sales rep worked this lead?". The /sales/stats page
-- needs that attribution: a "call" is defined as a sales-user note left on a
-- lead within the reporting window.
--
-- This table is an append-only log of every notes update via PATCH /api/leads/[id].
-- It is NOT a replacement for leads.notes (which still stores the current text
-- and powers the editor + email/SMS templates); it's purely an audit trail for
-- per-user attribution.
-- =============================================================================

create table if not exists lead_notes_log (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  shop_id uuid not null references shops(id) on delete cascade,
  user_id uuid references staff_users(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists lead_notes_log_lead_id_idx
  on lead_notes_log(lead_id);

create index if not exists lead_notes_log_user_id_created_at_idx
  on lead_notes_log(user_id, created_at desc);

create index if not exists lead_notes_log_shop_created_idx
  on lead_notes_log(shop_id, created_at desc);
