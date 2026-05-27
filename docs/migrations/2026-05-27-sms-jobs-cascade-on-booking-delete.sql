-- Applied 2026-05-27 in response to the Elli orphan-SMS incident
-- (booking hard-deleted from DB → ON DELETE SET NULL left the SMS job
-- in place with booking_id=null → worker's `if (job.booking_id && ...)`
-- guard fell through and fired a reminder for a booking that no longer
-- existed).
--
-- Worker code (lib/sms/scheduledSmsJobs.ts) was patched defensively in
-- commit 2ac0a65. This migration tightens the FK so orphans can't be
-- created at the source.

alter table scheduled_sms_jobs
  drop constraint scheduled_sms_jobs_booking_id_fkey;

alter table scheduled_sms_jobs
  add constraint scheduled_sms_jobs_booking_id_fkey
  foreign key (booking_id) references bookings(id) on delete cascade;
