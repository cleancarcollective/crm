# Clean Car Collective CRM: handover guide

For Stephen, new owner of Clean Car Collective Wellington. Settlement: 20 November 2026.

This guide explains what the CRM does, how it is put together, which accounts you need in your own name, and what to do on and after settlement. Everything here was checked against the code in this repo.

- Live site: https://crm.cleancarcollective.co.nz
- Code: GitHub repo `cleancarcollective/crm`
- Hosting: Vercel, team `cleancarcollectives-projects`
- Database and file storage: Supabase (Postgres)

---

## 1. What the CRM does

The CRM is the shop's booking system, customer database and messaging engine. Website bookings and estimate requests land here. Staff run the day from the calendar. The CRM sends the confirmation emails, reminder texts, "your car is ready" messages, review requests and follow-up offers on its own.

### Staff roles

Every staff login has a role: **admin**, **contractor** or **sales** (`lib/auth/roles.ts`). Sales users only see the sales pages and lead detail. Admins see everything, including Settings, reports and the Users page. There is also a **super-admin** flag that lets one login switch between shops. The vendor's account has it. Remove it after handover (see section 4).

Staff log in at `/login` with an email and password. Logins are stored in the CRM's own `staff_users` table, not in Supabase Auth.

### Daily use

The top menu has six tabs: Calendar, Leads, Clients, Sales, Reports and Settings. Sales is a drop-down (Cold leads, Services, Selling guide, Script, Objections, plus Rep stats for admins). Reports is a drop-down (Funnel, Revenue, Collective, Giveaway, Journey).

| Area | Where | What it does |
|---|---|---|
| Calendar | `/` (nav: Calendar) | Month view of bookings. Click a day to open the day view. |
| Day view | `/day/[date]` | All jobs for one day. You can also block a day, or part of a day, on the shop's Google Calendars so the website stops offering those slots. |
| + New Booking | Button on the calendar | Opens the New Booking modal. Search for an existing contact or add a new one, pick a vehicle, service, size (price fills in from your price list), date, time and location. Tick "Recurring" to create a repeating series. Choose whether to send the confirmation email and SMS. "Silent migration mode" turns every notification off, for loading old bookings. |
| Booking detail | `/bookings/[id]` | Edit the booking, change status (Pending, Confirmed, Completed, Cancelled, No Show), see notifications sent, upload photos, offer upsells, press Pick-up Ready. |
| Collective member alert | Booking detail, team booking email, calendar | When a paying Collective member books, the booking page shows a big banner with their plan, status, credit balance and washes this year. The team booking email is flagged at the top, and the calendar shows a MEMBER badge. |
| Cancelling a booking | Booking detail | Set the status to Cancelled and click "Save + email cancellation". The customer gets a cancellation email with the original date and how to rebook. |
| Pick-up Ready | Button on booking detail | Emails and texts the customer that the car is ready (there is an after-hours version), sets the booking to **Completed**, books a review-request SMS for about 23 hours later, and schedules the post-detail follow-ups. These are four email and SMS offers (next day, then 6, 10 and 16 weeks later) inviting the customer to lock in a recurring detail at a discount. They only go out for package services. Ceramic coatings, paint correction and customers already on a recurring series are skipped. The offers are set in `lib/bookings/postDetailTouchpoints.ts`. |
| Upsell tool | Booking detail, upsell panel | During a detail, staff pick an add-on (or a custom item), add a price and photos, and send. The customer gets a text (email if there is no phone) with a one-tap link that logs them into their account. If they approve, the item is added to the booking and the team is notified. |
| Before/after photos | Booking detail, photo panel | Staff upload before and after shots. Nothing goes to the customer until staff press "Send to customer". The customer then gets one branded email and the photos live in their account. Sending again later only announces new photos. Photos are stored in the Supabase storage bucket `detail-photos`. |
| Leads | `/leads` | Estimate requests from the website lead form. |
| Clients / contacts | `/clients`, `/contacts/[id]` | Customer directory with search, filters, import and export (spreadsheet). The contact page shows bookings, vehicles, notes, the credit ledger and an SMS opt-out switch. |
| Sales pages | `/sales`, `/sales/services`, `/sales/selling-guide`, `/sales/script`, `/sales/objections` | Cold-lead call list and sales reference material for the sales role. |
| Collective | `/collective` | Membership dashboard: sign-ups, paid members, churn, monthly revenue, outstanding credit. |
| Journey | `/journey` | A map of every automatic email and SMS the system sends, with on/off state and send counts. Good place to see what customers receive. |
| Giveaway | `/giveaway` | The Wellington October 2026 giveaway (entries and the Draw button). The giveaway has finished. |

### Leads and the auto-quote approval flow

1. A customer fills in the estimate form on the website. It posts to `/api/leads/intake`.
2. If auto-respond is switched on for the shop (Settings page), the CRM tries to work out the vehicle size and build the estimate email from your price list.
3. If the size is known with high confidence and the customer left no notes, the estimate is sent automatically about 3 minutes later.
4. Otherwise the lead goes to **needs approval**. The team gets an approval email with the draft estimate, a one-click "send as is" link and a link to review it in the CRM. When the customer left notes, an AI model (through OpenRouter) drafts a short reply paragraph to their notes. Staff review it before it goes.
5. At about 11am NZ time each day (see the time-zone note in section 6), the team gets a digest of **today's** leads still waiting for approval. Nothing is sent if there are none.

General lead follow-ups (3, 7 and 30 days) are switched off (`LEAD_FOLLOWUPS_ENABLED` is not "true"). A separate short nurture sequence for ad leads (day 1, 3 and 6) is on unless `AD_LEAD_NURTURE_ENABLED` is set to "false".

When a booking comes in from the same customer, the CRM links it back to their open lead so conversions are counted.

### Customer-facing pages

| Page | What it is |
|---|---|
| `/account` | The customer portal. Customers sign in with a magic link sent to their email (`/account/login`), no password. They see bookings, vehicles, photos, warranties, credit, reminders and upsell offers, and can request changes to a booking. |
| `/manage-booking` | Link in booking emails. Lets a customer view, reschedule or cancel one booking. |
| `/lock-in-recurring` | Link in the post-detail offers. The customer picks a cadence and start date and a recurring series is created at the discounted rate. |
| `/r/[code]` | Short links used in SMS. |
| `/lead-action/...` | Confirmation pages after one-click email links. |

### Collective membership

Customers join from the booking form or the portal. There is one membership, priced by vehicle size (the fees in the code are $100, $110, $120 and $130 a month ex-GST). Each paid month adds credit to the customer's account, more than the fee, and the credit never expires (`lib/portal/membership.ts`). Payment runs through Stripe Checkout and a Stripe webhook (`/api/stripe/webhook`).

If Stripe is not set up, sign-ups are still saved as "pending" but no payment link is created. The vendor's Stripe account is removed at settlement, so memberships stop taking payment until you connect your own Stripe (section 3).

### Settings

| Page | What it does |
|---|---|
| `/settings` | Auto-respond on/off, the **price list** (service x size, ex-GST), links to the pages below. |
| `/settings/account` | Change your own password. |
| `/settings/health` | System health checks (see section 7). |
| `/settings/sms-templates` | Edit the text of every SMS. |
| `/settings/templates` | Edit the estimate and booking email templates, with preview. |
| `/settings/users` | Admins add, edit and delete staff logins and set roles. |

### Reports

| Report | Where | Notes |
|---|---|---|
| Revenue | `/revenue` | Day by day, with week and month subtotals. "Booked" is confirmed plus completed, "Done" is completed only. Amounts are the booking price estimate, ex-GST. Cancelled bookings are left out. It currently shows both shops side by side. |
| Funnel | `/analytics` | Lead and booking funnel and attribution, live from the database. |
| Rep stats | `/sales/stats` (Sales menu, admins only) | Calls, wins, bookings and revenue per sales user, by service, over 30, 60 or 90 days. |
| Daily digest | Email, about 7am NZ | Yesterday's leads, bookings and conversions, today's jobs and revenue, and anything stuck. Goes to the shop team email. |
| Weekly conversion report | Email, Monday about 8am NZ | Goes to the shop team email. |
| Health alert | Email, about 8am NZ | Only sent when a health check is red. |

---

## 2. How it fits together

```
Website (WordPress, cleancarcollective.co.nz)
  |-- booking form (repo New-Booking-System) --> /api/bookings/intake
  |                                          --> /api/booking-series/intake (recurring)
  |                                          --> /api/public/availability (free slots)
  |                                          --> /api/portal/... (returning customer, membership)
  |                                          --> /api/vehicle-size, /api/funnel-events
  |-- estimate form (repo lead-form)       --> /api/leads/intake, /api/quote-events
  |-- price shortcode                      --> /api/public/pricing
                       |
                       v
           CRM (Next.js on Vercel)  <-->  Supabase Postgres + storage bucket "detail-photos"
                       |
   Gmail SMTP (hello@), Postmark, TNZ SMS, Stripe, Google Calendar,
   Google Ads (via Apps Script + Sheet), Meta Conversions API, OpenRouter
```

- **Booking form**: repo `New-Booking-System`, a separate app embedded in the website. Its service prices are written in its own code (`constants.ts`), not read from the CRM. It is hosted on Vercel as `new-booking-system` (new-booking-system.vercel.app) in the same Vercel team as the CRM, deploys on every push to `main`, and is shown on the website in an iframe on the Make a Booking page. The estimate form (`lead-form`, lead-form-six.vercel.app) works the same way.
- **Estimate form**: repo `lead-form`, a separate Vercel project called `lead-form`, embedded on the website.
- **Availability**: the booking form asks the CRM for free slots. The CRM asks a Google Apps Script per shop, which reads the shop's Google Calendars ("shop" and "mobile"). The CRM does not create Google Calendar events for bookings. It only writes "block day" events. New bookings do **not** go onto the Google Calendar, and they do not close slots on their own. Checked 18 Nov 2026: Monday 23 Nov had four CRM bookings, and the calendar only held the manual "Blocked via CRM" block. The booking form only hides times that are blocked on the calendar. So when the day is full, block it (or the hours) from the CRM day view, which writes a "Blocked via CRM" event to the calendar.
- **Database**: Supabase Postgres holds everything (shops, contacts, vehicles, leads, bookings, series, templates, message logs, job queues, memberships, credit, photos, upsells, staff logins). The CRM talks to it with the service-role key, from the server only.

### Scheduled jobs

There are three kinds. All cron times are in UTC.

**Vercel crons** (`vercel.json`, once a day each):

| Job | UTC | NZ (winter / summer) | What it does |
|---|---|---|---|
| `/api/emails/process-reminders` | 08:00 | 8pm / 9pm | Booking reminder backstop |
| `/api/integrations/meta-capi` | 06:00 | 6pm / 7pm | Sends recent bookings to Meta |
| `/api/integrations/google-ads-conversions` | 14:00 | 2am / 3am | Sends recent bookings to the Google Ads sheet |
| `/api/cron/regenerate-series` | 17:00 | 5am / 6am | Keeps recurring series 12 months ahead |
| `/api/emails/daily-digest` | 19:00 | 7am / 8am | Daily digest email |
| `/api/cron/health-alert` | 20:00 | 8am / 9am | Emails the team if a health check is red |
| `/api/emails/weekly-conversion` | Sun 20:00 | Mon 8am / 9am | Weekly conversion report |
| `/api/cron/portal-reminders` | 21:00 | 9am / 10am | "Your next detail is due" reminder emails |
| `/api/cron/giveaway-drip` | 21:40 | | Giveaway messages (giveaway has ended) |
| `/api/emails/daily-approval-pending` | 23:00 | 11am / 12pm | Leads waiting for approval |

**GitHub Actions** (`.github/workflows/`, for anything more often than daily):

| Workflow | Schedule | What it does |
|---|---|---|
| `email-health.yml` | Every 30 minutes | Calls `/api/cron/email-health`. If too many emails are failing, the run fails and GitHub emails the repo owner. |
| `warm-availability.yml` | Every 10 minutes, about 7am to 10pm NZ | Keeps the availability Apps Scripts warm so the booking form is fast. |
| `giveaway-drip.yml` | Every 20 minutes through the NZ day | Giveaway messages. The file says it is safe to delete after 1 Nov 2026. |

All three use the repo secret `CRON_SECRET`.

**Supabase pg_cron** (inside the database): a job named `process-scheduled-emails` calls `/api/emails/process-scheduled` every 2 minutes (`*/2 * * * *`) with `Authorization: Bearer <CRON_SECRET>`. This is the most important job. It sends the auto-estimates, ad-lead nurture messages, booking reminders, review SMS, post-detail offers and fallback team notifications from the job queues (`scheduled_email_jobs`, `scheduled_sms_jobs`). The job is not stored in this repo. See it in the Supabase SQL editor with `select * from cron.job;` and its run history in `cron.job_run_details`. The command contains the CRON_SECRET, so treat it as a secret.

### Outbound services

| Service | Used for |
|---|---|
| Gmail SMTP (hello@cleancarcollective.co.nz) | Nearly all email: booking confirmations and updates, pick-up ready, estimates, upsell offers, portal emails, photo emails, digests and team new-booking emails. |
| Postmark | Team notifications when a customer cancels or reschedules themselves, the health alert email, giveaway bulk email, and the backup sender when Gmail fails for portal emails and post-detail offer emails. Also open, click and bounce tracking via its webhook. |
| TNZ | All SMS. |
| Stripe | Collective membership payments. |
| Google Calendar | "Block day" writes (service account). Availability reads go through Apps Script. |
| Google Ads | Offline conversions: bookings from ad clicks go to a Google Sheet through an Apps Script, and Google Ads imports the sheet on a schedule. Setup is in `docs/google-ads-conversions-setup.md`. |
| Meta Conversions API | Sends each booking as a Purchase event so Meta Ads can see real revenue. |
| OpenRouter | AI help on estimates (reply to customer notes, vehicle size guess). Model: `anthropic/claude-sonnet-4.5`. |

---

## 3. Accounts and services you need in your own name

Get each of these set up in your name before or at settlement, then put the new keys into Vercel (Project, Settings, Environment Variables) and redeploy.

> **Deadline: Friday 4 December 2026.** Some keys in the CRM still belong to the vendor's own accounts, which Christchurch keeps using. The vendor switches these off on 4 Dec, so put your own in before then.
>
> | Service | Account stays with | What happens on 4 Dec if you haven't replaced it |
> |---|---|---|
> | TNZ (`TNZ_AUTH_TOKEN`) | Vendor | The vendor deletes this token. All texts fail until you add your own TNZ token. |
> | OpenRouter (`OPENROUTER_API_KEY`) | Vendor | The vendor deletes this key. Estimates still work, but leads with customer notes get no AI draft. |
> | Postmark (`POSTMARK_SERVER_TOKEN`) | You (the account now holds only the Wellington domains) | The vendor removes their card. Add your own card, or sending stops when the plan renews. |
> | Stripe (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) | Vendor | Removed at settlement on 20 Nov, not 4 Dec. Memberships take no payments until you connect your own Stripe (see below). |
>
> Until 4 Dec, texts and AI drafts sent from this CRM are charged to the vendor, so please keep usage to normal business.

| Service | What for | Env vars | Where to get the key |
|---|---|---|---|
| GitHub | Holds the code for `crm`, `New-Booking-System` and `lead-form`. Runs the GitHub Actions jobs. | Actions secret `CRON_SECRET` | github.com. The repos are transferred to you (section 4). |
| Vercel (Pro plan) | Hosts the CRM and runs the daily crons. Use Pro: Vercel's free Hobby plan is for non-commercial use only. | All env vars live here | vercel.com. Project or team transferred to you. |
| Supabase | Database and photo storage. | `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard, Project Settings, API. Project transferred to your organisation. |
| Google Workspace mailbox hello@ | Sends customer email through Gmail SMTP. | `GMAIL_APP_PASSWORD_WELLINGTON` | In the hello@ Google account: turn on 2-Step Verification, then create an App Password (the code comment suggests naming it "CRM SMTP"). Workspace after settlement: the vendor keeps the existing Google Workspace tenant (now used by Christchurch). You get the hello@ login on 20 Nov. Then set up your own Google Workspace on cleancarcollective.co.nz: the vendor gives you a Takeout export of hello@ and removes the domain from their tenant so you can add it to yours. When hello@ moves, make a new app password and update `GMAIL_APP_PASSWORD_WELLINGTON`. |
| Postmark | Team notifications, alerts, backup sender, email tracking. | `POSTMARK_SERVER_TOKEN`, `POSTMARK_WEBHOOK_SECRET`, optional `POSTMARK_BROADCAST_TOKEN`, `POSTMARK_BROADCAST_STREAM` | postmarkapp.com: Server, API Tokens. The code uses the message streams `booking-emails` and `broadcast`. Set the webhook URL to `https://crm.cleancarcollective.co.nz/api/email-events/postmark` with a custom header `x-postmark-webhook-secret` equal to `POSTMARK_WEBHOOK_SECRET`. Verify the sending domain in Postmark. |
| TNZ | SMS. | `TNZ_AUTH_TOKEN` | tnz.co.nz account, API settings. Sender ID: the code doesn't set one, so texts use the default sender ID on the TNZ account (set in the TNZ dashboard). Keep the balance topped up. |
| Stripe | Membership payments. | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | dashboard.stripe.com, Developers, API keys. See the Stripe steps below. |
| Google Cloud service account | Writes "block day" events to the shop calendars. | `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_CALENDAR_IMPERSONATE_EMAIL` | Google Cloud console: create a service account and a JSON key, paste the whole JSON into the env var. Workspace blocks sharing calendars with outside service accounts, so the code uses domain-wide delegation: allow the service account in Google Workspace Admin for the scope `https://www.googleapis.com/auth/calendar.events`, and set `GOOGLE_CALENDAR_IMPERSONATE_EMAIL` to a Workspace user who can edit the calendars. |
| Google Calendars and Apps Scripts | The shop and mobile calendars, and the availability script that reads them. | `AVAILABILITY_APPS_SCRIPT_WELLINGTON` (optional, the code has a built-in default URL) | The calendar IDs are written in `lib/google/calendarAdmin.ts`. The default script URL is in `app/api/public/availability/route.ts`. They are owned by hello@cleancarcollective.co.nz, so they come to you with that account. So does the Google Cloud project "Clean Car Collective Inspect" (gen-lang-client-0316556276), which holds the `ccc-crm-calendar-writer` service account used by Block day. If you create new ones, update both places. |
| Google Ads offline conversions | Sends booking value back to Google Ads. | `GOOGLE_ADS_SHEETS_WEBHOOK_URL_WELLINGTON`, `GOOGLE_ADS_SHEETS_WEBHOOK_SECRET` | A Google Sheet with an Apps Script web app, imported by your Google Ads account. Full steps in `docs/google-ads-conversions-setup.md`. |
| Meta Conversions API | Sends bookings to Meta. | `META_CAPI_ACCESS_TOKEN` | Meta Events Manager, your dataset (pixel), Settings, Conversions API, Generate access token. The dataset ID is **not** an env var: it is written in `lib/integrations/metaCapi.ts` (`DATASET_ID`). If you use your own dataset, change it there. The Facebook page, Instagram, ad account and this dataset transfer to you with the vendor's Business Manager access; Christchurch assets are removed first. |
| OpenRouter | AI help on estimates. | `OPENROUTER_API_KEY` | openrouter.ai, Keys. Add credit. Without a key, estimates still work but notes-based leads get no AI draft. |

### Stripe: before you relaunch memberships

The Stripe price IDs for the four size tiers are written in the code (`STRIPE_PRICE_IDS` in `lib/portal/stripe.ts`). They belong to the vendor's Stripe account and will not work in yours. To connect your own:

1. Put your Stripe secret key in `.env.local` on your computer (never commit it).
2. Run `npx tsx scripts/setup-stripe.ts`. It creates the product, the four monthly prices and the webhook endpoint in your Stripe, and prints the webhook signing secret.
3. Ask Claude Code to replace the four IDs in `STRIPE_PRICE_IDS` with the new ones.
4. Add `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in Vercel, push, and test a sign-up.

Wellington memberships on the vendor's Stripe are cancelled at settlement and the vendor's Stripe keys are removed from the CRM. Any prepaid amounts are dealt with in the settlement statement. Their credit balances stay in the CRM (`credit_ledger`).

### Every environment variable

None of these values are in the repo. They live in Vercel. Names only.

| Name | Purpose | Where it comes from |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Supabase, Project Settings, API |
| `SUPABASE_SERVICE_ROLE_KEY` | Full database access for the server | Supabase, Project Settings, API |
| `CRON_SECRET` | Password the cron jobs send. Vercel crons send it automatically. Also used by GitHub Actions and the pg_cron job. | You make it up (long random string) |
| `ACTION_TOKEN_SECRET` | Signs one-click links in emails (manage booking, lock-in, quick-send) | You make it up |
| `PORTAL_SESSION_SECRET` | Signs customer portal logins. Falls back to `ACTION_TOKEN_SECRET` if not set. | You make it up |
| `CRM_BASE_URL` | Base URL used in links. Optional, defaults to `https://crm.cleancarcollective.co.nz`. | Your domain |
| `GMAIL_APP_PASSWORD_WELLINGTON` | Gmail SMTP for hello@ | Google account App Password |
| `GMAIL_APP_PASSWORD_CHRISTCHURCH` | Gmail SMTP for ben@/info@ (Christchurch) | Remove after Christchurch cleanup |
| `POSTMARK_SERVER_TOKEN` | Postmark sending | Postmark |
| `POSTMARK_WEBHOOK_SECRET` | Checks Postmark webhook calls | You make it up, and set it in Postmark |
| `POSTMARK_BROADCAST_TOKEN` | Optional separate Postmark server for bulk email | Postmark |
| `POSTMARK_BROADCAST_STREAM` | Optional bulk stream name, default `broadcast` | Postmark |
| `TNZ_AUTH_TOKEN` | SMS | TNZ |
| `STRIPE_SECRET_KEY` | Membership payments | Stripe |
| `STRIPE_WEBHOOK_SECRET` | Checks Stripe webhook calls | Stripe (printed by `scripts/setup-stripe.ts`) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Google Calendar writes | Google Cloud service account key |
| `GOOGLE_CALENDAR_IMPERSONATE_EMAIL` | Workspace user the service account acts as | Your Workspace |
| `AVAILABILITY_APPS_SCRIPT_WELLINGTON` | Availability script URL (optional) | Apps Script deployment |
| `AVAILABILITY_APPS_SCRIPT_CHRISTCHURCH` | Christchurch availability script (optional) | Remove after cleanup |
| `GOOGLE_ADS_SHEETS_WEBHOOK_URL_WELLINGTON` | Google Ads conversion sheet script for Wellington | Apps Script deployment |
| `GOOGLE_ADS_SHEETS_WEBHOOK_URL` | Same, Christchurch (the original one) | Remove after cleanup |
| `GOOGLE_ADS_SHEETS_WEBHOOK_SECRET` | Shared secret sent to the sheet scripts | You make it up, and set it in the script |
| `META_CAPI_ACCESS_TOKEN` | Meta Conversions API | Meta Events Manager |
| `OPENROUTER_API_KEY` | AI drafting | OpenRouter |
| `ESTIMATE_AUTOMATION_WEBHOOK_URL` | Optional old estimate automation bridge. Skipped when not set. Dead code: nothing calls `sendEstimateAutomationBridge`, so this does nothing whether set or not. Delete it from Vercel | Legacy |
| `ESTIMATE_AUTOMATION_WEBHOOK_SECRET` | Secret for the above | Legacy |
| `LEAD_FOLLOWUPS_ENABLED` | Set to `true` to turn general lead follow-ups back on. Off otherwise. | Your choice |
| `AD_LEAD_NURTURE_ENABLED` | Set to `false` to turn off the ad-lead nurture sequence. On otherwise. | Your choice |
| `NODE_ENV` | Set by Vercel and Next.js | Automatic |

The booking form repo also reads an optional `VITE_CRM_INTAKE_URL` (defaults to the live CRM address).

---

## 4. Transfer checklist

Do these in order. Keep the vendor available on the day in case something needs their login.

### Ownership

- [ ] Create your GitHub account (or organisation), Vercel account on the **Pro** plan, and Supabase organisation.
- [ ] GitHub: the vendor transfers `crm`, `New-Booking-System` and `lead-form` to you (repo Settings, Transfer ownership). Check the Actions secrets are still there afterwards.
- [ ] Vercel: transfer the `crm` project (and the `lead-form` project, and the booking form's project if it is on Vercel) to your team, or have the vendor make you owner of `cleancarcollectives-projects`. Reconnect the Git integration to the transferred GitHub repo if Vercel asks.
- [ ] Check the domain `crm.cleancarcollective.co.nz` still points at the project. DNS for cleancarcollective.co.nz is at Crazy Domains (nameservers ns1/ns2.crazydomains.com), so it moves with the domain transfer (UDAI). Keep these records: the Google MX records (email), and `crm` pointing at Vercel.
- [ ] Supabase: the vendor transfers the project to your organisation (Project Settings, General, Transfer project). Put it on a paid plan with backups.
- [ ] Set up your own accounts for TNZ, Stripe and OpenRouter (the vendor's TNZ and OpenRouter keys are switched off on **Fri 4 Dec**), add your card to the Postmark account, and make sure you control the hello@ mailbox, the Google Calendars, the Apps Scripts, the Google Ads account and the Meta dataset.

### Swap every key

- [ ] Replace every service key in Vercel with one from your own accounts (table in section 3). Do not keep any of the vendor's keys.
- [ ] Generate new secrets: `CRON_SECRET`, `ACTION_TOKEN_SECRET`, `PORTAL_SESSION_SECRET`, `POSTMARK_WEBHOOK_SECRET`, `GOOGLE_ADS_SHEETS_WEBHOOK_SECRET`. A simple way: run `openssl rand -hex 32` in Terminal, once per secret.
- [ ] Rotate the Supabase service-role key (Supabase, Project Settings, API) and update `SUPABASE_SERVICE_ROLE_KEY`.
- [ ] Note: changing `ACTION_TOKEN_SECRET` breaks the one-click links in emails already sent (manage booking, lock-in offers, quick-send). Customers with an old link will see an error and need a fresh one. Changing `PORTAL_SESSION_SECRET` logs every customer out of the portal; they sign back in with a new magic link. Pick a quiet time.
- [ ] After changing `CRON_SECRET`, update it in three places or jobs will fail:
  1. Vercel env var.
  2. GitHub repo secret (`crm` repo, Settings, Secrets and variables, Actions).
  3. The Supabase pg_cron job. Look at it with `select jobid, jobname, schedule, command from cron.job;` and change the Bearer value in its command. Run this in the Supabase SQL editor (job id 1, `process-scheduled-emails`, every 2 minutes):
     ```sql
     select cron.alter_job(1, command := $$
       SELECT net.http_post(
         url := 'https://crm.cleancarcollective.co.nz/api/emails/process-scheduled',
         headers := jsonb_build_object(
           'Content-Type', 'application/json',
           'Authorization', 'Bearer <NEW_CRON_SECRET>'
         )
       );
     $$);
     ```
- [ ] Update the Postmark webhook header and the Google Ads Apps Script secret to match the new values.
- [ ] Redeploy (Vercel, Deployments, Redeploy) so the new env values take effect.

### People

- [ ] Create your own admin login in Settings, Users, and log in with it.
- [ ] Remove the vendor's staff login and super-admin access after handover (Settings, Users, Delete). The super-admin flag was set on `max@cleancarcollective.co.nz` (`docs/migrations/2026-05-09-super-admin.sql`). If the Users page will not delete it (it only deletes users in your shop), ask Claude Code to remove it with SQL. Also clear that user's rows in `staff_sessions`.
- [ ] Review every other staff login and reset passwords.
- [ ] Remove the vendor from GitHub, Vercel, Supabase, Postmark, Google and Meta. (TNZ and OpenRouter are the vendor's own accounts: you replace their keys, you don't take the accounts over.)

### Check it works

- [ ] Make a test booking on the website and check the CRM, the confirmation email and the SMS.
- [ ] Submit a test estimate request.
- [ ] Open `/settings/health` and check it is green.
- [ ] Run the `email-health` workflow by hand (GitHub, Actions, Email deliverability monitor, Run workflow) and check it passes.

---

## 5. Christchurch

The CRM was built for two shops and holds data for both. Christchurch has moved to its own separate CRM. After settlement the vendor removes the Christchurch data and settings from this one, in the week after settlement (from 23 Nov 2026), once the Christchurch CRM has run cleanly for a few days. A full database backup is taken first.

So you know where Christchurch lives in the code:

| Where | What |
|---|---|
| `shops` table | One row per shop (`slug` is `wellington` or `christchurch`). Nearly every other table has a `shop_id`. |
| `lib/email/shopContacts.ts` | Per-shop email identity: team email, reply address, phone, website, sender name and From line. The fallback for an unknown shop is Christchurch. |
| `lib/email/smtpClient.ts` | Maps sender addresses to Gmail app passwords (ben@ and info@ for Christchurch, hello@ for Wellington). |
| `lib/email/sendBookingEmail.ts`, `lib/email/sendPickupReadyEmail.ts` | `SHOP_DETAILS`: address, map link, phone per shop. |
| `lib/google/calendarAdmin.ts` | Calendar IDs per shop. |
| `app/api/public/availability/route.ts`, `app/api/cron/warm-availability/route.ts` | Availability script per shop. |
| `lib/integrations/googleAdsConversionExport.ts` | Google Ads sheet per shop. |
| `lib/autorespond/processLead.ts` | Christchurch 15% web price cut and Christchurch promo codes on estimates. |
| `app/api/public/pricing/route.ts` | Christchurch price experiment multiplier. |
| `app/revenue/page.tsx` | Shows both shops side by side. |
| `lib/portal/emails.ts`, `app/api/cron/portal-reminders/route.ts` | Christchurch booking page link. |
| `.github/workflows/email-health.yml` | Error text mentions the Christchurch app password. |

Until the cleanup is done, the Meta upload sends **all** shops' bookings to one dataset (there is no shop filter in `lib/integrations/metaCapi.ts`).

---

## 6. Known gotchas

- **Vercel crons only run once a day on this setup.** The current Vercel plan rejects schedules more often than daily, which is why the 10-minute and 30-minute jobs are GitHub Actions and the every-minute job is Supabase pg_cron. On Vercel Pro you could move them, but there is no need.
- **Cron times are UTC and do not follow daylight saving.** In NZ summer every scheduled email lands an hour later than in winter (the daily digest at 8am instead of 7am, the approval digest at 12pm instead of 11am).
- **New public pages and endpoints must be added to `PUBLIC_PREFIXES` in `middleware.ts`.** Anything not on that list redirects to the staff login. That would break a website form or a customer link without any error showing in the CRM.
- **An expired or changed Gmail app password stops customer email silently.** In August 2026 Wellington email failed for about 5 days because the app password had expired. Booking confirmations, pick-up emails and estimates have no backup sender, so they just fail. Changing the hello@ Google password also revokes its app passwords. The `email-health` workflow (every 30 minutes, emails the GitHub repo owner) and `/settings/health` exist to catch this. Make sure GitHub notifications reach you.
- **If the pg_cron job stops, reminders and auto-estimates stop.** Jobs that are more than about 6 hours overdue are skipped, not sent late, so an outage means lost messages, not a flood later. The health page shows "pg_cron may be down" when jobs are over an hour late.
- **Check a deploy** on the GitHub commit (the tick or cross next to it, or `gh api repos/OWNER/crm/commits/SHA/statuses`) or in the Vercel dashboard.
- **Keep the TNZ balance topped up.** When it runs out, texts fail.
- **There are three price lists.** The Settings price list (`pricing` table) feeds the New Booking modal and the auto-estimates. The Services page and the website price shortcode read the `service_offerings` table. The website booking form has its own prices in `New-Booking-System/constants.ts`. Change all three when prices change. The upsell add-on prices in `lib/upsells/catalog.ts` copy the booking form's add-ons.
- **Wellington emails and texts are signed "Max".** The Wellington sender name is set in `lib/email/shopContacts.ts` (`sender_name`), and the built-in estimate templates in `lib/autorespond/templates.ts` end with "Max". The templates saved in Settings were checked on 18 Nov 2026 and do not mention Max. Change the code ones to your name.
- **No em dashes in outbound messages.** There is code that strips em dashes from every email and SMS (`lib/email/stripEmDashes.ts`, used by the Gmail, Postmark and TNZ clients). The vendor pushes this before handover.
- **SMS opt-outs.** `contacts.sms_opt_out` stops marketing texts (offers, nurture, giveaway). Booking texts (confirmation, reminder, car ready, review, upsell) still go. A fallback list of opted-out contact IDs is also written in `lib/sms/consent.ts`.
- **Photos are public links.** Photos in the `detail-photos` bucket are served by public URL. Anyone with the link can see the photo.
- **`docs/schema.sql` is out of date.** It was last updated in May 2026 and is missing many tables the code uses (memberships, staff_users and sessions, pricing, photos, upsells, portal tables, credit ledger and more). The live database is the truth.
- **The giveaway is over** but its GitHub workflow still runs every 20 minutes and its daily Vercel cron is still listed. Both can be removed.
- **Vercel Instant Rollback pauses auto-deploys.** After a rollback, new pushes do not go live until you undo the rollback or promote a deployment (section 8).
- **`docs/AGENTS.md` is old.** It describes the first version ("Christchurch store only for now", "don't build payments"). Use `CLAUDE.md` instead.

---

## 7. Health checks and what to do when something breaks

**Where to look**

- `/settings/health`: email and SMS queues, cron heartbeat, failed jobs in the last 7 days, recurring series regeneration, Postmark webhook, lead and booking intake in the last 24 hours, auto-respond state, stuck leads, template coverage, email send rate, bounces, active templates, pricing rows, future bookings with no phone. Red means fix now, amber means degraded.
- Health alert email, about 8am: only sent when something is red.
- GitHub Actions: a failed `email-health` run means email is failing.
- Vercel dashboard, Logs: errors from the live site.
- Supabase, SQL editor: `select * from cron.job_run_details order by start_time desc limit 20;` shows whether the every-minute job is running.

**Common problems**

| Symptom | Likely cause | Fix |
|---|---|---|
| Customers not getting emails, `email-health` failing | Gmail app password expired or changed | Make a new App Password for hello@, update `GMAIL_APP_PASSWORD_WELLINGTON` in Vercel, redeploy. |
| No texts going out | TNZ balance empty or token wrong | Top up TNZ, check `TNZ_AUTH_TOKEN`. |
| Reminders, auto-estimates and review texts stopped, health page says pg_cron may be down | pg_cron job stopped, or `CRON_SECRET` changed without updating the job | Check `cron.job_run_details`. Make sure the job's Bearer value matches `CRON_SECRET`. |
| Website bookings or estimates not arriving | Bad deploy, or a public route missing from `PUBLIC_PREFIXES` | Roll back in Vercel (section 8), then fix. |
| Booking form slow on "Finding slots" | Availability Apps Script cold, or the warm workflow failing | Check the `warm-availability` workflow runs. |
| Membership sign-ups never become active | Stripe keys or webhook wrong | Check `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and the webhook in Stripe points to `/api/stripe/webhook`. |
| Block day fails | Service account or impersonation setup wrong | Check `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_CALENDAR_IMPERSONATE_EMAIL` and domain-wide delegation. |
| Whole site down right after a push | Bad deploy | Roll back in Vercel first, fix second. |

You can run any cron by hand to test it:
`curl -H "Authorization: Bearer YOUR_CRON_SECRET" https://crm.cleancarcollective.co.nz/api/cron/email-health`

---

## 8. Working on the CRM with Claude Code

You do not need to write code yourself. Claude Code reads the repo, makes the change, and shows you exactly what it changed. `CLAUDE.md` in this folder tells it how this project works.

**One-time setup on your Mac**

1. Install Node.js (the LTS version from nodejs.org) and Git (macOS offers to install it the first time you type `git`).
2. Install Claude Code: follow the instructions at https://docs.claude.com/en/docs/claude-code, then run `claude` in Terminal and sign in.
3. Install the Vercel command-line tool: `npm install -g vercel`, then `vercel login`.
4. Get the code:
   ```
   cd ~/Documents
   git clone https://github.com/YOUR-ACCOUNT/crm.git
   cd crm
   npm install
   ```
5. Link it to Vercel and download the settings:
   ```
   vercel link
   vercel env pull .env.local
   ```
   Pick your team and the `crm` project when asked. `.env.local` holds secrets. It is already ignored by Git, so it will never be uploaded. Do not share it. `vercel env pull` brings down the Development values by default. Use `vercel env pull --environment=production .env.local` to get the live ones. Anything marked Sensitive in Vercel always comes down empty: copy those from the service itself (Postmark, TNZ, Stripe and so on).

Be careful: the local copy talks to the **live** database and live email and SMS accounts. Anything you test locally can message real customers.

**Making a change**

1. In Terminal: `cd ~/Documents/crm` then `claude`.
2. Say what you want in plain English. For example: "Change the Wellington sender name from Max to Stephen in emails and texts" or "Add a Gift Voucher service to the price list".
3. Claude Code will explain its plan and edit the files. Ask it questions if anything is unclear.
4. Ask it to run the checks: "run typecheck and lint".
5. Review the change: ask "show me the diff", or run `git diff`. Read what changed. If you are unsure, ask Claude Code to explain each part.
6. When happy, ask it to commit and push to `main`. Vercel deploys automatically in a minute or two.
7. Check the deploy went green (GitHub commit tick, or the Vercel dashboard), then test the thing you changed on the live site. If you changed anything to do with bookings or email, make a test booking.

**Rolling back a bad deploy**

1. Open the Vercel dashboard, the `crm` project, **Deployments**.
2. Find the last deployment that worked (marked Ready, before the bad one).
3. Click the three dots next to it and choose **Instant Rollback** (or **Promote to Production**).
4. The live site switches back within seconds.
5. While rolled back, new pushes do not go live automatically. Fix the problem (ask Claude Code to revert the bad commit with `git revert`), push, then promote the new deployment or undo the rollback in Vercel.

Database changes are not undone by a Vercel rollback. That is why database changes go through a written SQL file first (see `CLAUDE.md`).
