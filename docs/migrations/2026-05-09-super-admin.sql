-- =============================================================================
-- Super-admin flag on staff_users — lets a single account access every shop
-- via the in-nav shop switcher (active-shop cookie). Default false. Most
-- staff stay scoped to their home shop and never see the switcher.
-- =============================================================================

alter table staff_users
  add column if not exists is_super_admin boolean not null default false;

-- Promote Max — change the email if you want a different super-admin
update staff_users set is_super_admin = true
where email = 'max@cleancarcollective.co.nz';
