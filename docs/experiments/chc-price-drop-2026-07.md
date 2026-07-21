# Christchurch web-form 15% price drop — experiment baseline

**Experiment id:** `chc-web-15off-2026-07`
**Surface:** Christchurch MAIN booking form only (`Christchurch-Booking-System`).
Ad funnels (`?funnel=ceramic`, `?funnel=interior`) keep their own offer pricing and are excluded.
**Change:** every service + add-on sticker price × 0.85 (15% off). Flat mobile call-out fee ($80) unchanged.
**Live from:** 2026-07-20 (Pacific/Auckland) — confirm against first tagged booking.
**Control:** Wellington (unchanged, full price).

## Hypothesis
Dropping CHC web-form prices 15% lifts booking conversion/volume enough to offset the lower per-job price. CHC has historically converted online traffic far worse than Wellington (see `ccc_unit_economics` — CHC organic 1.9% vs WLG 6.2% book rate), so this tests whether price is a barrier.

## How the post-change cohort is identified
Authoritative: `raw_payload->>'price_experiment' = 'chc-web-15off-2026-07'` (stamped on every main-form submission while live).
Fallback (date): `booking_source = 'Website Booking Flow'` AND `created_at >= '2026-07-20'` for the CHC shop.

## FROZEN pre-period baseline (source of truth = bookings table)
Window: **2026-04-06 → 2026-07-19** (Pacific), 15 complete weeks. Numbers below are frozen — do not recompute over a shifted window.

### CHC bookings per week
| Source | Total (15 wk) | Avg/wk | Last 4 complete wk (06-22→07-13) |
|---|---|---|---|
| Website Booking Flow (web form) | 21 | **1.4/wk** | 0, 0, 3, 0 |
| All sources | 55 | **3.67/wk** | 1, 2, 6, 6 |

Web-form weekly series (wk start → count): 04-06:1, 04-13:1, 04-20:3, 04-27:3, 05-04:1, 05-11:1, 05-18:2, 05-25:1, 06-01:2, 06-08:2, 06-15:1, 06-22:0, 06-29:0, 07-06:3, 07-13:0.

Note: recent CHC online conversions shifted toward the interior/ceramic **ad funnels** (2 interior-ad-deluxe on 16 & 18 Jul), so main-form web volume understates total online demand.

### CHC web-form AOV (ex-GST)
avg **$436**, median **$379** (min $94.50, max $796.50, n=21).
After 15% off → avg ≈ **$371**, median ≈ **$322**.

### CHC last-90d booking status (all sources, as of 2026-07-20)
completed 19 · confirmed/upcoming 25 · cancelled 3.

### Wellington reference (same window, control)
web form ≈ 8/wk (100 total), all-source ≈ 22/wk, web-form AOV avg $385 / median $390.

## Funnel (session) baseline — UNRELIABLE, do not use as primary
Session tracking (`funnel_events`) only started 2026-07-14, so there is ~1 week of pre-period data and it is bot-heavy:
- CHC: 101 sessions, **79 (78%) lasted <1s = bots/prefetch**, 21 engaged (3s+), 15 reached scheduling, 3 review, **0 booked** (low volume + ad-funnel completions don't fire the `booked` beacon).
Use bookings-per-week as the primary metric; treat funnel conversion as directional only.

## Power caveat (READ BEFORE JUDGING THE TEST)
At ~1.4 web bookings/week, weekly counts are too small to detect a lift quickly. Expect to need **6–8+ weeks** of post-change data before a sustained shift is distinguishable from noise. Judge on a rolling multi-week rate vs this frozen baseline and vs Wellington's trend over the same period — not week-to-week.

## Read-out queries
```sql
-- Post-change CHC web-form volume + AOV (tagged cohort)
select date_trunc('week',(b.created_at at time zone 'Pacific/Auckland'))::date wk,
       count(*) n, round(avg(b.price_estimate)) avg_price
from bookings b join shops s on s.id=b.shop_id
where s.slug='christchurch' and b.raw_payload->>'price_experiment'='chc-web-15off-2026-07'
group by wk order by wk;

-- CHC vs WLG all-source weekly (context / control)
select date_trunc('week',(b.created_at at time zone 'Pacific/Auckland'))::date wk, s.slug,
       count(*) filter (where b.booking_source='Website Booking Flow') web_form,
       count(*) all_src
from bookings b join shops s on s.id=b.shop_id
where b.created_at >= '2026-04-01'
group by wk, s.slug order by wk, s.slug;
```
