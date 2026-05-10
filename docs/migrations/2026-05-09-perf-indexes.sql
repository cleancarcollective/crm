-- =============================================================================
-- Performance indexes for the directory pages
-- =============================================================================
-- After the Orbis migration Wellington has ~4,500 leads, ~4,300 contacts,
-- and ~1,000 bookings. Directory pages were doing sequential scans on
-- shop_id + ordering by updated_at / scheduled_start, plus ilike searches
-- with leading wildcards (which can't use a regular btree index).
--
-- This migration adds:
--   1. Composite btree indexes for the common filter+order patterns
--   2. pg_trgm extension + GIN trigram indexes on contacts.full_name /
--      email / phone — makes "name LIKE '%smith%'" near-instant.
--
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
-- =============================================================================

-- ── 1. Trigram extension + indexes for fast ilike searches ───────────────
create extension if not exists pg_trgm;

create index if not exists contacts_full_name_trgm
  on contacts using gin (lower(full_name) gin_trgm_ops);

create index if not exists contacts_first_name_trgm
  on contacts using gin (lower(first_name) gin_trgm_ops);

create index if not exists contacts_last_name_trgm
  on contacts using gin (lower(last_name) gin_trgm_ops);

create index if not exists contacts_email_trgm
  on contacts using gin (lower(email) gin_trgm_ops);

create index if not exists contacts_phone_trgm
  on contacts using gin (phone gin_trgm_ops);

-- ── 2. Directory ordering / filter indexes ───────────────────────────────
-- Leads: shop_id + updated_at desc covers "most recent leads in shop X"
create index if not exists leads_shop_updated_at_idx
  on leads (shop_id, updated_at desc);

-- Leads: contact_id is queried for per-contact lead history + counts
create index if not exists leads_contact_id_idx
  on leads (contact_id);

-- Leads: status filter on the directory page
create index if not exists leads_shop_status_idx
  on leads (shop_id, status);

-- Bookings: shop_id + scheduled_start desc covers the calendar + clients dir
create index if not exists bookings_shop_scheduled_start_idx
  on bookings (shop_id, scheduled_start desc);

-- Bookings: contact_id queried for client booking history + counts
create index if not exists bookings_contact_id_idx
  on bookings (contact_id);

-- ── 3. Stats analyse — let the planner use the new indexes ──────────────
analyse contacts;
analyse leads;
analyse bookings;
