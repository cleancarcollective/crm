/**
 * Seed two reactivation call scripts into sales_resources (type='script'):
 *   - Warm: previous customers ~6 months since last detail (5% off + freebie)
 *   - Cold: enquiry-only, never booked (10% off + freebie)
 *
 * Idempotent on slug. Usage: npx tsx scripts/seed-reactivation-scripts.ts
 */

import fs from "node:fs";
import path from "node:path";
function loadEnv(f: string) {
  const p = path.join(process.cwd(), f);
  if (!fs.existsSync(p)) return;
  for (const l of fs.readFileSync(p, "utf-8").split("\n")) {
    const t = l.trim();
    if (!t || t.startsWith("#")) continue;
    const e = t.indexOf("=");
    if (e === -1) continue;
    const k = t.slice(0, e).trim();
    let v = t.slice(e + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv(".env.local"); loadEnv(".env.vercel.local");

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

const WARM_BODY = `**Use for:** previous customers, roughly 6 months since their last detail. They already know us - this is warm.

---

### Opener
"Hey [First name], it's [your name] from Clean Car Collective - have you got a quick sec?"

*(If busy: "No worries, when's a better time to grab you? I'll give you a call back.")*

### Why you're calling
"Awesome. So I was going through our books and saw it's been about 6 months since we last sorted your [vehicle] - I made a note to reach out in case it's due for another deep clean."

### The offer
"Since you've had us out before, I figure you're the type who likes to keep the car maintained between proper details. So I've got a little welcome-back deal for you: **5% off your next detail, plus a free ceramic spray sealant and a microfibre cloth** to help you keep it looking sharp between visits."

### Close (always offer two specific times)
"Want me to lock you in? I've got [day] morning or [day] afternoon free this week - which suits better?"

### If not now
"All good. Want me to check back in a few weeks, or is the timing just off for now?" -> mark **Callback** or **Not interested** in the CRM.

---

**Notes:**
- The freebie (ceramic spray + cloth) is the hook - lead with the value, not the discount.
- 5% is within your standard on-call authority.
- Recommend the same service tier they had last time (check their booking history on the contact page), or step them up to Premium if it's been a while.`;

const COLD_BODY = `**Use for:** people who enquired but never booked. Colder - they may have gone elsewhere or forgotten. Bigger hook (10%).

---

### Opener
"Hey [First name], it's [your name] from Clean Car Collective - have you got a quick sec?"

*(If busy: offer a callback.)*

### Why you're calling
"So you reached out to us a while back about a detail for your [vehicle], but we never got you locked in. I wanted to check whether the timing was just off at the time, or if you ended up sorting it somewhere else."

*(Listen. If they went elsewhere and were happy -> thank them, mark Not interested. If they still need it -> go to the offer.)*

### The offer
"No worries either way. Since it's been a while, I can do you a one-off **10% off to get you in the door, plus a free ceramic spray sealant and a microfibre cloth** so you can keep it looking good between details."

### Close (two specific times)
"Want me to find you a spot? I've got [day] morning or [day] afternoon - which works?"

### If not interested
"All good, I'll close it off so we stop bugging you. If you ever change your mind you've got my number." -> mark **Not interested** in the CRM.

---

**Notes:**
- 10% here is ABOVE the standard 5% on-call authority - it's pre-approved specifically for this cold-reactivation campaign. Don't go higher without checking Max.
- These are colder, so expect more no's - that's fine. A clean "no" + marking them Lost is a win (stops the system chasing them).
- Don't oversell. Qualify what they actually need (use the Selling guide) and quote the right tier.`;

const SCRIPTS = [
  { slug: "reactivation-warm", title: "Reactivation - previous customers (5% + freebie)", body: WARM_BODY, order: 10 },
  { slug: "reactivation-cold", title: "Reactivation - enquiry only, never booked (10% + freebie)", body: COLD_BODY, order: 11 },
];

(async () => {
  const supabase = getSupabaseAdminClient();
  for (const s of SCRIPTS) {
    const { error: insErr } = await supabase.from("sales_resources").insert({
      slug: s.slug,
      type: "script",
      title: s.title,
      body_markdown: s.body,
      display_order: s.order,
      shop_id: null,
    });
    if (insErr && insErr.code === "23505") {
      const { error: updErr } = await supabase
        .from("sales_resources")
        .update({ title: s.title, body_markdown: s.body, display_order: s.order, type: "script" })
        .eq("slug", s.slug)
        .is("shop_id", null);
      if (updErr) { console.error(s.slug, "update failed:", updErr); process.exit(1); }
      console.log(`Updated ${s.slug}`);
    } else if (insErr) {
      console.error(s.slug, "insert failed:", insErr); process.exit(1);
    } else {
      console.log(`Inserted ${s.slug}`);
    }
  }
})();
