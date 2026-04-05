# CRM Development Instructions

## Project context
This is a lightweight custom CRM for Clean Car Collective.

The goal is to replace Zapier + OrbisX for booking intake and data storage.

## Current priority
- Booking intake endpoint
- Contact creation and matching
- Vehicle creation and matching
- Booking storage in Supabase

## Rules
- Keep the system simple
- Do NOT overbuild
- Do NOT redesign the booking flow yet
- Use the existing booking payload format
- Christchurch store only for now
- Keep schema multi-shop ready

## Architecture
- Booking page sends payload → CRM API → Supabase
- No Zapier in booking flow

## Coding guidelines
- Use TypeScript
- Keep functions small and clear
- Avoid unnecessary abstraction
- Prefer readable code over clever code

## What NOT to build yet
- Invoicing
- Payments
- Full CRM UI
- Complex automations
- Estimate system replacement

## Definition of done (v1)
- Booking payload creates contact, vehicle, and booking
- Data stored correctly in Supabase
- Raw payload is saved
- Endpoint returns clean JSON response
