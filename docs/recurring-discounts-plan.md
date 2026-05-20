# Recurring discounts + post-detail follow-up automation

**Started:** 2026-05-19

## Goal

Turn one-off detail bookings into recurring revenue by offering tiered
discounts at two touchpoints: (1) during the booking form flow, and
(2) automated follow-ups after a completed detail.

## Tiers

Applied to **package services only** (not ceramic coatings or paint
corrections). Specifically:

- Deluxe Detail (interior + exterior)
- Premium Detail (interior + exterior)
- Deluxe Interior Detail
- Deluxe Exterior Detail
- Premium Interior Detail
- Premium Exterior Detail

| Cadence | Discount | Deluxe full | Premium full |
|---|---|---|---|
| Every 2 months | 15% | $314.50 | $531.25 |
| Every 3 months | 10% | $333.00 | $562.50 |
| Every 4 months | 5% | $351.50 | $593.75 |
| One-time | 0% | $370.00 | $625.00 |

Prices above are Christchurch reference. Wellington may differ — confirm
from each booking form's hardcoded prices when building.

## Build phases

### Phase A — Booking form discount picker (in progress)

**Goal:** when a customer picks an eligible service on the booking form,
show a recurring-cadence picker before review.

**Files touched:**
- `Christchurch-Booking-System/` — booking form UI
- `New-Booking-System/` — Wellington booking form UI
- `crm/app/api/booking-series/intake/route.ts` — new public endpoint
  (mirrors `/api/bookings/intake` pattern; verifies via shared HMAC
  secret like the existing intake)
- `crm/app/api/public/pricing/route.ts` — new public read-only endpoint
  returning the pricing table for a given shop slug

**Pricing-auto-populate — DEFERRED (decided 2026-05-19):** the CRM today
has a simpler estimate-pricing table (service × size, no duration); the
booking form has a richer schema (4 vehicle types × price × duration).
Unifying them is a separate ~3-4hr sub-project (new richer table + CRUD
UI + migration + form fetch wiring). Not blocking the discount feature —
discount is `price * 0.85/0.90/0.95` regardless of where the base price
comes from. Tracked as Phase E (future).

### Phase B — Post-detail touchpoint automation

**Trigger:** when a booking flips to `status='completed'` (staff
action), schedule 4 follow-up touchpoints. Each is a SMS + email pair.

| When | Featured tier | SMS opener |
|---|---|---|
| Same day, 6pm | 15% (all 3 offered) | "Loved the result? Lock in a recurring rate now and save 15%" |
| 6 weeks | 2-month / 15% | "Time for the next one — 15% off if you go fortnightly" |
| 10 weeks | 3-month / 10% | "Heading into the 3-month window — last chance for 10% off" |
| 16 weeks | 4-month / 5% | "Past 4 months the car needs a full detail. Lock in 5% now" |

Storage: new `scheduled_email_jobs.template_key` values:
- `post_detail_recurring_offer_day0`
- `post_detail_recurring_offer_6w`
- `post_detail_recurring_offer_10w`
- `post_detail_recurring_offer_16w`

Same for `scheduled_sms_jobs.template_key`.

If a customer locks in a recurring series at any touchpoint, cancel the
remaining touchpoints (mark `status='cancelled'` with a friendly
`last_error`).

If a customer ignores all 4 — that's fine, no further automated
follow-up. Manual outreach is on staff after that.

### Phase C — "Lock in recurring" customer page

**Goal:** a token-authed page at `/lock-in-recurring?token=...` linked
from every touchpoint email/SMS. Customer sees their last booking, picks
a cadence (preselected to whichever tier the touchpoint featured), picks
a first date, confirms.

**On confirm:** creates a `booking_series` with the right
`discount_percent` and `discount_source='post_detail_offer'`. Pre-fills
the customer/vehicle from the prior booking. Series-confirmation email
fires as normal.

Auth: same signed-token pattern as `/manage-booking` (HMAC, expires in
30 days, single-use).

### Phase E — Unified pricing table (deferred)

Move pricing source of truth from the booking forms' hardcoded
`constants.ts` to a CRM table. Today CRM has a simpler estimate-pricing
table; the form has 4 vehicle types × price × duration. Plan: new
`booking_pricing` table with the richer schema, CRUD UI under Settings,
public read-only API endpoint at `/api/public/pricing?shop=<slug>`,
both forms fetch on load + cache in localStorage. ~3-4hr.

### Phase F — Roadmap items raised during testing (2026-05-20)

**F1. Should the lock-in page live on the customer-facing domain?**

Currently lives at `crm.cleancarcollective.co.nz/lock-in-recurring`.
Customers clicking from the touchpoint emails see the staff-looking
"crm." subdomain. The /manage-booking page sets a precedent (also on
the CRM domain) but worth challenging.

Options:
- Stay on CRM domain. Cheapest, working today, "manage-booking"
  precedent already shipped without complaints.
- Build a WP page at cleancarcollective.co.nz/lock-in-recurring that
  iframes the CRM page (same pattern as the booking forms). The
  customer URL becomes cleancarcollective.co.nz; the page itself stays
  in the CRM repo. ~30 min of WP work + verify cookies + token query
  string pass-through.
- Rebuild as a Vite app standalone (overkill, skip).

**F2. Should the touchpoint email force the featured cadence, or
expose all 3 picker options upfront?**

Today the email's CTA links to `?cadence=N` for the featured tier (15%
on the day-0/6w touchpoint, 10% on 10w, 5% on 16w). Customer can still
change the tier on the lock-in page itself, but the email visually
biases them toward one option.

Alternatives to test:
- Show all 3 cadence options as separate buttons in the email ("15% -
  every 2 months" / "10% - every 3 months" / "5% - every 4 months").
  Each button preselects its tier on the lock-in page.
- Keep the single featured CTA but also link the other tiers in the
  price-comparison table beneath it.
- A/B if conversion data eventually warrants.

Hypothesis: featured-only converts better because it's a simpler ask
("yes/no") instead of a 3-way decision in the inbox. But worth real
data, not a guess.

### Phase D — Customer login portal (future)

Mentioned by user 2026-05-19 — not part of this build but worth keeping
in mind. Would let customers see all upcoming bookings + manage
recurring series without needing a fresh token every time. Probably
Supabase Auth with magic-link login. Separate spec.

## Decisions made 2026-05-19

1. **Same pricing both shops** — confirmed at start of phase A by
   reading both forms. (If they differ, the pricing API has shop scope
   anyway.)
2. **Eligible services** — package services only. Listed above.
3. **Cadence enforcement** — trust customer on dates. If they cancel
   the whole series, they lose the rate. Cancelling individual
   occurrences = keep the rate.
4. **Drift OK** — re-scheduling pushes the next date back but doesn't
   change pricing.
5. **All 4 touchpoints fire regardless of engagement** — until they
   either lock in or cancel the chain.
6. **Both SMS + email** at every touchpoint.
7. **Pricing auto-populate** — yes, fetch from CRM. Worth the extra
   hour.
8. **Customer portal** — phase D, future.

## Future-proofing already in place

- `booking_series.discount_percent` (numeric)
- `booking_series.discount_source` (text: 'staff_manual',
  'customer_signup', 'post_detail_offer')
- `booking_series.series_source` (text: where the series came from)

These were added in step 1 of the recurring-bookings build
(2026-05-17) specifically for this work.

## How to resume

If a future Claude session picks this up: read this file first, then
check `git log --oneline | head -20` to see how far through the phases
we've gotten. Each phase commits independently.
