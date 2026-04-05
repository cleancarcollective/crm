# Christchurch CRM MVP

## Goal
Build a lightweight internal CRM to replace the core functionality currently handled by OrbisX for the Christchurch store.

## Scope (v1)
- Supabase as the backend database
- Booking intake from existing website booking system
- Replace Zapier webhook with our own API endpoint
- Store:
  - contacts
  - vehicles
  - bookings
- Prepare for:
  - booking confirmation emails
  - reminder emails

## Important constraints
- Do NOT rebuild the booking page
- Do NOT redesign payload yet
- Use the existing booking payload shape
- Keep system simple and low-cost
- Christchurch only for now, but schema should support multi-shop

## Primary workflow
Booking page → CRM API → Supabase

## Success criteria
- Booking submission creates:
  - contact
  - vehicle
  - booking
- Raw payload is stored
- No Zapier dependency
