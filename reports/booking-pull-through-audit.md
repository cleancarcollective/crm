# Booking pull-through audit

Mock scenario: customer books on the website 7 days out (e.g. booked Friday 5pm for service on next Friday 11am). What follows is **every email and SMS** the system sends from the moment the booking arrives through to 24h after pickup.

Identical flow for both Christchurch and Wellington — only the per-shop copy (sender address, signature, phone, website) differs. Everything else is shared code.

---

## Step-by-step timeline

### T+0 — Booking received

Customer hits **Book** on the website. The form posts to `/api/bookings/intake`. Within ~2 seconds, four things fire:

| # | Channel | To | Template | Notes |
|---|---|---|---|---|
| 1 | Email | **Customer** | `booking-confirmation` | Subject: "Booking confirmed for {service} on {date}". From per-shop sender (`info@` for CHC, `hello@` for WLG). Includes service, date, time, vehicle, location, price estimate, customer notes. |
| 2 | Email | **Team** | `booking-team-notification` | Subject: "New booking: {service} on {date} at …". Sent to the shop's `team_email`. |
| 3 | SMS | **Customer** | `booking_confirmation` (SMS) | Body: "Hi {name}, your booking is confirmed for {date_time}. See you soon! - Clean Car Collective". Sent immediately via TNZ. |
| 4 | (DB) | — | — | Three reminder email jobs and one reminder SMS job get queued in `scheduled_email_jobs` + `scheduled_sms_jobs`. |

If the customer has no email or no phone, the matching message is silently skipped.

---

### T+~0 (or shortly after) — Reminder: 1 week before

Booking is 7 days out, so the **week reminder** scheduled time is approximately *now*.

- If `scheduledFor > now` at the moment the filter runs (likely true by milliseconds): **week reminder email is queued** and fires when pg_cron next picks it up (within 1 minute).
- If `scheduledFor <= now`: the job is filtered out and the week reminder is **not sent** for this booking.

**In practice**: a 7-day-out booking made on Friday at 5pm will queue a week-reminder for ~Friday 5pm next week, and on the day the cron processes it normally — that's **6 days, 23 hours later**. See "What fires" below.

| # | Channel | To | Template | Trigger |
|---|---|---|---|---|
| 5 | Email | **Customer** | `booking-reminder-week` | pg_cron `/api/emails/process-scheduled` (every minute) picks up the queued job once `scheduled_for` is reached. Subject: "Reminder: {service} on {date} at {time}". |

---

### T+6d (1 day before service)

| # | Channel | To | Template | Trigger |
|---|---|---|---|---|
| 6 | Email | **Customer** | `booking-reminder-day` | pg_cron picks up at exactly `scheduled_start - 24h`. Subject: "Reminder: {service} tomorrow at {time}". |
| 7 | SMS | **Customer** | `booking_reminder_day` (SMS) | Vercel cron `/api/sms/process-review` runs once daily at **9am UTC = 9pm NZ NZST / 10pm NZDT**. Body: "Hi {name}, friendly reminder - your Clean Car Collective booking is tomorrow, {date_time}. Reply if anything's changed. See you soon!" |

> ⚠️ **Timing note on SMS**: the SMS processor only runs **once per day** (Vercel cron, not pg_cron). So a reminder SMS scheduled for, say, Thursday 11am NZ will actually go out at the next 9pm NZ run — i.e. **up to ~10 hours late**. If you want SMS to fire close to the scheduled time, we'd need to either: (a) move SMS processing to pg_cron every minute, or (b) increase the cron frequency. Flagging — easy fix.

---

### T+6d 23h (1 hour before service)

| # | Channel | To | Template | Trigger |
|---|---|---|---|---|
| 8 | Email | **Customer** | `booking-reminder-hour` | pg_cron picks up at exactly `scheduled_start - 1h`. Subject: "Reminder: {service} starts in one hour". |

---

### T+7d (service day)

No automated messages around the appointment itself. Staff perform the work in person.

When the vehicle is **ready for collection**, staff opens the booking in the CRM and clicks **"Mark ready for pickup"** → POST `/api/bookings/[id]/pickup`:

| # | Channel | To | Template | Notes |
|---|---|---|---|---|
| 9 | Email | **Customer** | (in-code template, not DB) | `sendPickupReadyEmail`. Subject: "Your vehicle is ready for pick-up!" — or after-hours variant if it's after 4pm shop time. |
| 10 | SMS | **Customer** | `pickup_normal` or `pickup_after_hours` | Body: "Hi {name}, {vehicle} is ready for pick-up! …" — after-hours version asks for ETA if more than 30 mins away. |
| (booking) | — | — | — | Booking status is set to `completed`. |
| (queue) | — | — | — | A review-request SMS is queued for **23h later**. |

---

### T+7d 23h (~1 day after pickup)

| # | Channel | To | Template | Trigger |
|---|---|---|---|---|
| 11 | SMS | **Customer** | `review_request` (SMS) | Vercel cron `/api/sms/process-review` daily at 9pm NZ. Body: "Hey {name}, thanks again for choosing Clean Car Collective! We'd love your quick feedback - just tap here: https://cleancarcollective.co.nz/how-did-we-do/" |

This is the last automated touch.

---

## Summary table

| Time | What fires | Customer-facing |
|---|---|---|
| T+0s | Booking confirmation email | ✓ |
| T+0s | Team notification email | (internal) |
| T+0s | Booking confirmation SMS | ✓ |
| ~T+0 (if 7d out) | Week reminder email | ✓ (probable but boundary-dependent) |
| T+6d | Day reminder email | ✓ |
| T+6d evening | Day reminder SMS | ✓ (delayed up to ~10h by daily cron) |
| T+6d 23h | Hour reminder email | ✓ |
| (manual) | Pickup-ready email | ✓ |
| (manual) | Pickup-ready SMS | ✓ |
| (manual) +23h | Review-request SMS | ✓ |

**Customer-facing total**: 8–9 messages from booking to post-service review (depending on whether the week reminder fires).

---

## Wellington readiness check ✅

Before today's parity sync, Wellington had **0 email_templates** — meaning all 4 booking emails (confirmation, team-notif, week/day/hour reminders, update) would have **silently skipped**. After the sync, both shops have all 7 templates and behave identically.

After the SMS migration ran, both shops also have all 6 SMS templates in the database. Until then, the SMS code falls back to `SMS_TEMPLATE_DEFAULTS` in code — so SMS already worked, it just gave staff no per-shop edit ability.

---

## Issues worth fixing

1. **SMS cron frequency** — currently daily, so reminder & review SMS fire up to 10h late. Recommend moving SMS processing onto pg_cron every minute (mirror the email setup) or at minimum hourly. Estimated 15 min of work.
2. **Week-reminder boundary** — bookings exactly 7 days out are racy: the filter `scheduled_for > now` either fires or skips depending on a few-millisecond window. Recommend changing to `scheduled_for >= now - 5 minutes` so it always queues for fresh bookings. Trivial.
3. **No "thank you" email after pickup** — only an SMS review request. If you want an email companion (some customers don't engage with SMS), that's a small add.
4. **Pickup-ready email is in-code, not in `email_templates`** — different from the booking emails which are DB-templated. Inconsistent. Lower priority.

Want me to fix 1 and 2 now? They're 30 min combined.
