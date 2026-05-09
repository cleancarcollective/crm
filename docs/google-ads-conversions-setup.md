# Google Ads offline conversion tracking — setup guide

End-to-end goal: when a booking completes in the CRM, push the actual booking
value back to Google Ads, so Smart Bidding can optimize for revenue (not just
lead count).

## How it works

```
Website lead form (gclid)
  │
  ▼
CRM /api/leads/intake  →  leads.gclid stored
  │
  ▼
Booking is created     →  bookings.created_at (any non-cancelled status)
  │
  ▼
Daily cron (2am NZ)    →  POST rows to Apps Script web app
  │
  ▼
Apps Script            →  appends rows to Google Sheet (de-duped)
  │
  ▼
Google Ads             →  scheduled import from Sheet (3x/day)
  │
  ▼
Smart Bidding          →  optimizes for actual $ revenue
```

## One-time setup

### 1. Database migration

```sql
ALTER TABLE leads
  ADD COLUMN gclid TEXT,
  ADD COLUMN gbraid TEXT,
  ADD COLUMN wbraid TEXT,
  ADD COLUMN landing_url TEXT;

CREATE INDEX leads_gclid_idx ON leads (gclid) WHERE gclid IS NOT NULL;
```

### 2. Website JS — capture gclid into the lead form

On every page that hosts the lead form (or the site-wide `<head>`):

```html
<script>
(function () {
  // Read ?gclid (or gbraid/wbraid) from URL, persist to a 90-day cookie.
  // 90 days matches Google Ads' default attribution window.
  function setCookie(name, value, days) {
    var d = new Date();
    d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
    document.cookie = name + "=" + value + ";expires=" + d.toUTCString() + ";path=/;SameSite=Lax";
  }
  function getCookie(name) {
    var m = document.cookie.match("(^|;)\\s*" + name + "=([^;]+)");
    return m ? m[2] : null;
  }
  var url = new URL(window.location.href);
  ["gclid", "gbraid", "wbraid"].forEach(function (k) {
    var v = url.searchParams.get(k);
    if (v) setCookie("ccc_" + k, v, 90);
  });

  // When the lead form submits, attach the IDs as hidden fields.
  // Adjust the form selector to match the site's form.
  document.addEventListener("submit", function (e) {
    var form = e.target;
    if (!form || form.tagName !== "FORM") return;
    if (!form.action || form.action.indexOf("/api/leads/intake") === -1) return;

    function addHidden(name, value) {
      if (!value) return;
      var input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      form.appendChild(input);
    }
    addHidden("gclid", getCookie("ccc_gclid"));
    addHidden("gbraid", getCookie("ccc_gbraid"));
    addHidden("wbraid", getCookie("ccc_wbraid"));
    addHidden("landing_url", window.location.href);
  }, true);
})();
</script>
```

If the lead form posts JSON (not multipart) — adjust the JS to inject these
fields into the JSON body before submission. Same idea, different plumbing.

### 3. Google Sheet + Apps Script web app

We use **one Sheet with one tab per shop**. Each shop's Google Ads account
imports from its own tab — that way Christchurch bookings only get credited
to the Christchurch ad account, and Wellington to Wellington. (Don't dump
everything in one tab — Google Ads scheduled imports pull the whole sheet
into whichever account is connected, and you'd cross-attribute revenue.)

1. Create a new Google Sheet. Name it `Clean Car Collective — Google Ads conversions`.
2. Create two tabs (rename "Sheet1" + add a new tab):
   - `Christchurch`
   - `Wellington`
3. In **both tabs**, add this header row in row 1 (exact order, exact spelling):

   | Google Click ID | Conversion Name | Conversion Time | Conversion Value | Conversion Currency | GBRAID | WBRAID | Email | Booking ID |

4. `Extensions → Apps Script`. Replace the placeholder code with:

   ```javascript
   const WEBHOOK_SECRET = "REPLACE_WITH_LONG_RANDOM_STRING";

   // shop_slug → tab name. Add new shops here as we expand.
   const TAB_BY_SHOP = {
     christchurch: "Christchurch",
     wellington: "Wellington",
   };

   function doPost(e) {
     const headerSecret = e.parameter && e.parameter.secret;
     const body = JSON.parse(e.postData.contents);
     const bodySecret = body.secret;
     if (headerSecret !== WEBHOOK_SECRET && bodySecret !== WEBHOOK_SECRET) {
       return ContentService.createTextOutput(
         JSON.stringify({ ok: false, error: "unauthorized" })
       ).setMimeType(ContentService.MimeType.JSON);
     }

     const ss = SpreadsheetApp.getActiveSpreadsheet();
     // Build per-tab dedupe sets up front so we don't reread the sheet
     // for every row.
     const dedupeByTab = {};
     Object.values(TAB_BY_SHOP).forEach((tabName) => {
       const tab = ss.getSheetByName(tabName);
       if (!tab) return;
       const data = tab.getDataRange().getValues();
       const bookingIdCol = 8; // 9th column = Booking ID (0-indexed 8)
       dedupeByTab[tabName] = new Set(data.slice(1).map((r) => r[bookingIdCol]));
     });

     const result = { appended: 0, skipped_duplicate: 0, skipped_unknown_shop: 0 };

     (body.rows || []).forEach((row) => {
       const tabName = TAB_BY_SHOP[row.shop_slug];
       if (!tabName) {
         result.skipped_unknown_shop++;
         return;
       }
       const tab = ss.getSheetByName(tabName);
       if (!tab) {
         result.skipped_unknown_shop++;
         return;
       }
       if (dedupeByTab[tabName] && dedupeByTab[tabName].has(row.booking_id)) {
         result.skipped_duplicate++;
         return;
       }
       tab.appendRow([
         row.gclid || "",
         row.conversion_action || "Booking value (CRM offline)",
         row.conversion_time || "",
         row.value || 0,
         row.currency || "NZD",
         row.gbraid || "",
         row.wbraid || "",
         row.email_sha256 || "",
         row.booking_id || "",
       ]);
       if (dedupeByTab[tabName]) dedupeByTab[tabName].add(row.booking_id);
       result.appended++;
     });

     return ContentService.createTextOutput(
       JSON.stringify({ ok: true, ...result })
     ).setMimeType(ContentService.MimeType.JSON);
   }
   ```

5. Replace `WEBHOOK_SECRET` with a long random string (e.g.
   `openssl rand -hex 32`). Keep it.
6. Click **Deploy → New deployment → Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone** (the secret is the gate)
7. Authorize. Copy the deployed Web app URL.

### 4. CRM environment variables (Vercel)

```
GOOGLE_ADS_SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/.../exec
GOOGLE_ADS_SHEETS_WEBHOOK_SECRET=<the random string from step 3>
```

After saving, redeploy so the env vars are picked up by the cron.

### 5. Google Ads — set up the conversion action (in EACH shop's account)

We do this once per shop, in the matching Google Ads sub-account under the
MCC (Christchurch account → Christchurch tab; Wellington account → Wellington
tab). Settings are identical between the two; only which sheet tab the
account is connected to differs.

1. **Tools → Conversions → New conversion action → Import → Other data sources or CRM → Track conversions from clicks**.
2. Name it exactly `Booking value (CRM offline)` (this must match the
   `Conversion Name` column the CRM writes — same name in both accounts).
3. Category: **Purchase**.
4. Value: **Use different values for each conversion**. Default currency: NZD.
5. Count: **One** (de-dupe per booking).
6. Click-through window: 90 days. View-through: 1 day.
7. **Counting → Goal type / Conversion goal: set to SECONDARY.** This is the
   safety wheel — the new conversion is visible in reports but Smart Bidding
   ignores it. You can flip it to Primary later once the data looks clean
   (typically after 2–4 weeks).
8. Save.

Repeat in the second account.

### 6. Google Ads — schedule the import from Sheets

In each shop's account, schedule the import to pull from that shop's tab.

1. **Tools → Conversions → Uploads → Schedules → New schedule**.
2. Source: **Google Sheets**.
3. Pick the sheet — and then **the matching tab** (Christchurch tab in
   the Christchurch account; Wellington tab in the Wellington account).
4. Frequency: **Every 6 hours** (or daily — whichever you prefer).
5. Save.

Repeat in the second account, picking the other tab.

You're done. Google Ads will now pull the rows on a schedule and credit them
against the right ad clicks.

### 7. Smoke test

1. Visit the website with `?gclid=test_gclid_123` in the URL.
2. Submit the lead form.
3. Verify in Supabase: `SELECT id, gclid FROM leads ORDER BY created_at DESC LIMIT 1` — should show `test_gclid_123`.
4. (Optionally) push that lead's contact to a booking and complete it.
5. Manually trigger the cron:
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" \
     https://crm.cleancarcollective.co.nz/api/integrations/google-ads-conversions
   ```
6. Check the Sheet — a new row should appear within seconds.
7. Check Google Ads → Conversions → Uploads → it'll show the imported conversion within ~6 hours.

## Operating notes

- **Trigger = booking created, not completed.** The cron looks at bookings
  whose `created_at` is in the previous 24h and `status != 'cancelled'`.
  Booking made today → appears in tomorrow's batch.
  - **Why not "completed"?** Detail jobs book 1-3 weeks ahead. Waiting for
    completion means Google Ads sees the conversion 1-3 weeks after the
    click — way too slow for Smart Bidding to learn from. Booked = same-day
    signal.
  - **Cancellation handling**: not built yet. ~5-10% of bookings cancel,
    creating equivalent noise in reported revenue. v2: when a booking flips
    to cancelled, upload a Google Ads conversion-adjustment that subtracts
    the value retroactively. For now, accept the noise.
- $0 bookings are skipped — Google Ads rejects them.
- Bookings without a matching gclid still go to the sheet with a hashed
  email — Google's Enhanced Conversions for Leads matches some of those.
- The Apps Script de-dupes on `Booking ID`, so re-running the cron is safe.
- To manually replay a window, hit the endpoint with a Bearer token (from
  the Vercel env vars).

## Future: direct Google Ads API + cancellation adjustments

The data shape is identical to the Google Ads `ConversionUploadService`
RPC. When we eventually want sub-minute reporting and don't want to babysit
a Sheet, swap `googleAdsConversionExport.ts` to call the API directly. The
Apps Script + Sheet stay as a fallback / audit trail.

For cancellations: add a parallel cron that looks at bookings flipping to
`cancelled` and uploads `ConversionAdjustment` rows (operation = "RETRACT"
or "RESTATE" with value 0). Same Sheet, different sheet tab, same Google
Ads scheduled-import surface.
