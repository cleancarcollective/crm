-- Vehicle size LLM lookup cache.
--
-- The auto-respond flow resolves vehicle size via:
--   1. Hardcoded MODEL_DB (~120 NZ models)
--   2. NEW: this cache (sizes resolved previously via LLM or staff override)
--   3. LLM call (Claude) when both miss
--
-- Each successful LLM resolution writes its result here so the next
-- enquiry for the same vehicle skips the LLM call entirely. Over time
-- this becomes a free, shop-tuned vehicle DB that doesn't require
-- maintaining MODEL_DB by hand.
--
-- Staff can also override via source='staff_override' for cases the
-- LLM gets wrong (e.g. an unusual ute variant).
--
-- Keys are NORMALISED versions (lowercase, alias-resolved) so we hit the
-- same row regardless of how the customer typed it. Use the
-- normalizeMake / normalizeModel helpers from lib/autorespond/vehicleSizing.

create table if not exists vehicle_size_lookups (
  make_normalized text not null,
  model_normalized text not null,
  size text not null check (size in ('Small','Medium','Large','XL')),
  confidence numeric(3,2) not null,
  source text not null check (source in ('llm','staff_override')),
  rationale text,
  hit_count integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_hit_at timestamptz not null default now(),
  primary key (make_normalized, model_normalized)
);

create index if not exists vehicle_size_lookups_make_idx
  on vehicle_size_lookups(make_normalized);

-- Bump updated_at / last_hit_at automatically on every UPDATE.
create or replace function bump_vehicle_size_hit() returns trigger as $$
begin
  new.updated_at = now();
  new.last_hit_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists vehicle_size_lookups_bump on vehicle_size_lookups;
create trigger vehicle_size_lookups_bump
  before update on vehicle_size_lookups
  for each row execute function bump_vehicle_size_hit();
