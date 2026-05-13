-- =============================================================================
-- Auto-zero price_estimate when a booking is cancelled
-- =============================================================================
-- Multiple code paths can flip booking.status to 'cancelled' (customer
-- self-service via /api/public/booking-action, staff edits via the
-- BookingEditor, future bulk status updates, etc.). Doing this in a
-- trigger means we never have to remember to also zero the price in
-- application code — it just happens.
--
-- Effect: when status transitions to 'cancelled', price_estimate is
-- forced to 0. Other transitions are unaffected.
--
-- Run in the Supabase SQL editor. Idempotent.
-- =============================================================================

create or replace function bookings_cancel_zero_price() returns trigger
language plpgsql as $$
begin
  if new.status = 'cancelled'
     and (old.status is distinct from 'cancelled')
     and new.price_estimate is distinct from 0 then
    new.price_estimate := 0;
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_cancel_zero_price_trigger on bookings;
create trigger bookings_cancel_zero_price_trigger
  before update on bookings
  for each row execute function bookings_cancel_zero_price();

-- Back-fill: zero out existing cancelled rows.
update bookings
   set price_estimate = 0
 where status = 'cancelled'
   and price_estimate is distinct from 0;
