# CLAUDE.md: Clean Car Collective CRM

Instructions for Claude Code working in this repo. The owner is Stephen (Clean Car Collective Wellington). He runs the business and is not a developer. Explain changes in plain English, keep diffs small, and show him the diff before committing. `HANDOVER.md` is his guide to the system; read it for context. `docs/AGENTS.md` is out of date, ignore it.

## Stack

- Next.js 15 (App Router, `typedRoutes: true`), React 19, TypeScript.
- Hosted on Vercel. Live at https://crm.cleancarcollective.co.nz.
- Supabase Postgres, accessed server-side only with the service-role client (`getSupabaseAdminClient()` in `lib/supabaseAdmin.ts`). Supabase Auth is not used: staff logins are in `staff_users` / `staff_sessions` (`lib/auth/session.ts`, PBKDF2 hashes in `lib/auth/password.ts`).
- Storage bucket `detail-photos` (public URLs) for before/after and upsell photos.
- Email: Gmail SMTP via nodemailer (`lib/email/smtpClient.ts`) for nearly everything; Postmark (`lib/email/postmarkClient.ts`) for some team notifications, the health alert, bulk mail and as a fallback in `lib/portal/emails.ts` and `lib/email/sendPostDetailOffer.ts`.
- SMS: TNZ REST API (`lib/sms/tnzClient.ts`).
- Other integrations: Stripe (plain fetch, no SDK), Google Calendar (service account JWT, no SDK), Google Ads offline conversions (Apps Script + Sheet), Meta Conversions API, OpenRouter (`lib/llm/openrouterClient.ts`).
- No test suite.

## Running locally

```
npm install
vercel link              # once: pick the crm project
vercel env pull .env.local
npm run dev              # http://localhost:3000
```

`.env.local` and `.env.vercel.local` are gitignored. Never print, read out, or commit their contents.

Local dev uses the **live** database, Gmail, Postmark and TNZ. Anything that sends a message will reach real customers. Before testing a send path locally, warn Stephen and use a test contact with his own email and phone.

One-off scripts live in `scripts/` and run with `npx tsx scripts/NAME.ts`. They load `.env.local` themselves. Many write to the live database: read a script before running it and say what it will do.

## Checks

```
npm run typecheck   # next typegen && tsc --noEmit
npm run lint        # next lint
npm run build       # full production build, the best pre-push check
```

There is no ESLint config file in the repo, so `next lint` may prompt to create one. If it does, skip lint and rely on typecheck and build.

## Deploy flow

- Push to `main` and Vercel deploys to production automatically. There is no staging.
- Verify the deploy: the commit status on GitHub (`gh api repos/{owner}/crm/commits/{sha}/statuses`) or the Vercel dashboard. Do not report a change as live until the deploy is green.
- To undo a bad deploy fast: Vercel dashboard, Deployments, Instant Rollback on the last good one. Then `git revert` the bad commit and push. After an Instant Rollback, new pushes do not go live until the rollback is undone or a deployment is promoted.
- Only commit or push when Stephen asks. Show the diff first.

## Database changes

1. Write a SQL file in `docs/migrations/` named `YYYY-MM-DD-short-description.sql`. Use `if not exists` / `if exists` so it is safe to run twice. Add a header comment saying why.
2. Stephen applies it in the Supabase SQL editor (or via `psql` with the connection string from Supabase). Apply it **before** pushing code that depends on it.
3. Update `docs/schema.sql` to match.

`docs/schema.sql` is badly out of date (last touched May 2026). Many tables in use are missing from it: `memberships`, `credit_ledger`, `staff_users`, `staff_sessions`, `pricing`, `shop_settings`, `detail_photos`, `upsell_offers`, `upsell_items`, `portal_login_tokens`, `portal_reminders`, `portal_events`, `coating_warranties`, `short_urls`, `funnel_events`, `quote_events`, `consumed_action_tokens`, `lead_email_templates`, and the RPC `apply_upsell_item`. Before relying on a table's columns, check the live schema (ask Stephen to run a query against `information_schema.columns`, or use `supabase db dump --schema-only` if he has the CLI set up). Offer to refresh `docs/schema.sql` from the live schema.

A Vercel rollback does not undo a migration. Prefer additive changes (new columns or tables) over renames or drops.

## Conventions seen in the code

- Imports use the `@/` alias. Server helpers live in `lib/`, UI in `components/dashboard` (staff) and `components/portal` (customer).
- Staff API routes scope everything to the current shop with `requireCurrentShop()` (`lib/auth/currentShop.ts`) and filter queries by `shop_id`. Keep doing this. Role checks are in `lib/auth/roles.ts`; API routes must check roles themselves, not rely on hidden UI.
- Public endpoints called by the website set CORS headers with a local `withCors` helper and handle `OPTIONS`.
- Customer one-click links use signed tokens from `lib/auth/signedTokens.ts` (action, resource id, shop, expiry; single use via `consumed_action_tokens`).
- Timezone is `Pacific/Auckland`, taken from `shops.timezone`. Use `date-fns-tz` for local-day logic. Cron schedules are UTC.
- Money: booking prices (`price_estimate`, `pricing.price_ex_gst`) are ex-GST dollars. Membership and upsell amounts are cents. Check which before doing maths.
- Outbound email and SMS go through the existing senders, which log to `email_messages`. House rule: no em dashes in any customer message. `lib/email/stripEmDashes.ts` strips them in the Gmail, Postmark and TNZ clients; if that file is missing from the repo, it was never committed, so tell Stephen.
- SMS text comes from `sms_templates` via `loadAndRenderSms`; defaults are in `lib/sms/smsTemplateDefaults.ts`. Marketing texts must respect `contacts.sms_opt_out` (`lib/sms/consent.ts`).
- Delayed sends are rows in `scheduled_email_jobs` / `scheduled_sms_jobs`, processed every minute by `/api/emails/process-scheduled`. Schedulers are idempotent (unique keys per booking and template). Follow this pattern rather than sending from a cron directly.
- Comments explain why, often with dates of past incidents. Keep them and add your own for anything non-obvious.
- Customer-facing marketing numbers (prices, percentages) should be round.

## Adding a cron

1. Create `app/api/cron/NAME/route.ts` with a `GET` handler. Copy the `isAuthorized` pattern from `app/api/cron/regenerate-series/route.ts` (accept `Authorization: Bearer ${CRON_SECRET}`). Make the job safe to run twice.
2. Add the path to `PUBLIC_PREFIXES` in `middleware.ts` with a comment saying when it runs. Without this, the request redirects to login.
3. Schedule it:
   - Once a day or less: add it to `crons` in `vercel.json` (UTC). Vercel sends `CRON_SECRET` automatically.
   - More often than daily: Vercel rejects it on this setup. Add a workflow in `.github/workflows/` modelled on `warm-availability.yml` (curl with the `CRON_SECRET` repo secret), or a Supabase pg_cron job.
4. If it can fail silently, add a check in `lib/health/checks.ts` so it shows on `/settings/health`.

## Rules

- Never commit secrets, keys, tokens or `.env*` files. Never paste secret values into code, comments, docs or chat. New config goes in an env var; tell Stephen to add it in Vercel (Settings, Environment Variables) and redeploy, and document the name in `HANDOVER.md`.
- Do not break the public endpoints the website forms and customer links use. The booking form (`New-Booking-System` repo) and estimate form (`lead-form` repo) post to these, and their payload shapes must stay compatible:
  `/api/bookings/intake`, `/api/booking-series/intake`, `/api/leads/intake`, `/api/public/availability`, `/api/public/booking-prefill`, `/api/public/pricing`, `/api/vehicle-size`, `/api/funnel-events`, `/api/quote-events`, `/api/portal/*` (including `membership/join`, `auth/request-link`, `checkout/*`), `/api/stripe/webhook`, `/api/email-events/postmark`, `/manage-booking`, `/lock-in-recurring`, `/account`, `/r/*`, `/lead-action/*`.
- Any new public page or endpoint must be added to `PUBLIC_PREFIXES` in `middleware.ts`.
- After changing booking, lead, email or SMS code, test the booking flow end to end before calling it done: a test booking from the website (or the New Booking modal) using Stephen's own contact details, then check the booking in the CRM, the confirmation email and the SMS. Check `/settings/health` afterwards.
- Changing `ACTION_TOKEN_SECRET` breaks links in emails already sent. Changing `CRON_SECRET` needs updating in Vercel, the GitHub Actions secret and the Supabase pg_cron job. Say so before suggesting either.
- Prices exist in three places: `pricing` table (Settings page; New Booking modal and auto-estimates), `service_offerings` table (Services page, website price shortcode), and `New-Booking-System/constants.ts` (booking form). Upsell add-ons in `lib/upsells/catalog.ts` mirror the booking form. Mention all of them when prices change.
- Christchurch has moved to its own CRM. Do not add new Christchurch features. Christchurch config is listed in `HANDOVER.md` section 5.
- Keep changes small and readable. Prefer editing existing files over adding new abstractions.

## Key file map

| Path | What |
|---|---|
| `middleware.ts` | Auth gate. `PUBLIC_PREFIXES`, token-authed patterns, customer-page flag. |
| `vercel.json` | Daily Vercel crons (UTC). |
| `.github/workflows/` | `email-health.yml` (30 min), `warm-availability.yml` (10 min), `giveaway-drip.yml` (finished). |
| `app/page.tsx`, `app/day/[day]/page.tsx` | Calendar and day view. |
| `app/bookings/[id]/page.tsx`, `components/dashboard/BookingDetail.tsx` | Booking detail, Pick-up Ready button. |
| `components/dashboard/NewBookingModal.tsx`, `app/api/bookings/manual/route.ts` | New Booking modal and its API. |
| `app/api/bookings/[id]/pickup/route.ts` | Pick-up Ready: email, SMS, Completed, review SMS, post-detail offers. |
| `app/api/bookings/[id]/upsells/route.ts`, `lib/upsells/` | Upsell tool. |
| `app/api/bookings/[id]/photos/`, `lib/portal/photoEmails.ts` | Before/after photos. |
| `app/api/bookings/intake/route.ts`, `lib/bookingIntake/` | Website booking intake. |
| `app/api/booking-series/`, `lib/bookings/series.ts` | Recurring bookings. |
| `app/api/leads/intake/route.ts`, `lib/autorespond/` | Lead intake, auto-quote, approval logic, AI drafting. |
| `app/api/emails/process-scheduled/route.ts` | Every-minute job processor (called by pg_cron). |
| `lib/email/` | All email senders, `shopContacts.ts` (per-shop identity), `smtpClient.ts`. |
| `lib/sms/` | TNZ client, SMS templates, scheduled SMS, consent. |
| `lib/bookings/postDetailTouchpoints.ts` | Post-detail recurring offers. |
| `app/account/`, `app/api/portal/`, `lib/portal/` | Customer portal, magic link, membership, Stripe. |
| `app/api/stripe/webhook/route.ts`, `lib/portal/stripe.ts` | Stripe webhook and hardcoded price IDs. |
| `lib/integrations/googleAdsConversionExport.ts`, `lib/integrations/metaCapi.ts` | Ad conversion uploads (Meta dataset ID is hardcoded here). |
| `lib/google/calendarAdmin.ts`, `app/api/calendar/block-day/route.ts` | Calendar IDs, block-day writes. |
| `app/api/public/availability/route.ts` | Availability proxy to Apps Script. |
| `lib/health/checks.ts`, `app/settings/health/page.tsx`, `app/api/cron/health-alert/route.ts`, `app/api/cron/email-health/route.ts` | Health checks and alerts. |
| `app/settings/` | Settings pages (pricing, templates, SMS templates, users, account, health). |
| `app/revenue/`, `app/analytics/`, `app/sales/stats/`, `app/journey/`, `app/collective/` | Reports. |
| `lib/journey/touchpoints.ts` | Registry of automatic customer messages shown on `/journey`. |
| `docs/migrations/`, `docs/schema.sql` | SQL migrations and (out of date) schema. |
| `docs/google-ads-conversions-setup.md` | Google Ads offline conversion setup. |
| `scripts/` | One-off maintenance scripts (`npx tsx`). |
