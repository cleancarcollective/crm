/**
 * Replace the booking-confirmation + reminder email templates with friendlier
 * copy (no more "this is your one-day reminder for your upcoming booking").
 * Updates Christchurch first (canonical source) then re-runs the sync to
 * Wellington.
 */

import fs from "node:fs";
import path from "node:path";

function loadEnv(file: string) {
  const envPath = path.join(process.cwd(), file);
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnv(".env.local");

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

const TEMPLATES: Array<{ key: string; subject: string; body: string }> = [
  {
    key: "booking-confirmation",
    subject: "Your {{service_name}} booking is confirmed — {{scheduled_date}}",
    body: `Hi {{first_name}},

Thanks for booking with {{shop_name}} — you're locked in:

{{service_name}}
{{scheduled_date}} at {{scheduled_time}}
Vehicle: {{vehicle_label}}
Where: {{location_type}}
Estimated: {{price_estimate}}

{{notes}}

Need to make changes? Just reply to this email and we'll sort it.

See you soon,
{{shop_name}}`,
  },
  {
    key: "booking-reminder-week",
    subject: "See you in a week — {{service_name}} on {{scheduled_date}}",
    body: `Hi {{first_name}},

Just a heads-up that your booking with {{shop_name}} is coming up in a week. Here's a recap so you can plan ahead:

{{service_name}}
{{scheduled_date}} at {{scheduled_time}}
Vehicle: {{vehicle_label}}
Where: {{location_type}}
Estimated: {{price_estimate}}

If anything's changed or you need to reschedule, just reply to this email.

See you soon,
{{shop_name}}`,
  },
  {
    key: "booking-reminder-day",
    subject: "Tomorrow: {{service_name}} at {{scheduled_time}}",
    body: `Hi {{first_name}},

Quick reminder that your booking is tomorrow:

{{service_name}}
{{scheduled_date}} at {{scheduled_time}}
Vehicle: {{vehicle_label}}
Where: {{location_type}}
Estimated: {{price_estimate}}

If anything's changed, reply and let us know — otherwise we'll see you then.

{{shop_name}}`,
  },
  {
    key: "booking-reminder-hour",
    subject: "Your {{service_name}} starts in an hour",
    body: `Hi {{first_name}},

You're booked in with us in about an hour:

{{service_name}}
{{scheduled_time}} today
Vehicle: {{vehicle_label}}
Where: {{location_type}}

Looking forward to it.

{{shop_name}}`,
  },
  // Legacy generic reminder — kept in case any code path still uses it
  {
    key: "booking-reminder",
    subject: "Reminder: {{service_name}} on {{scheduled_date}}",
    body: `Hi {{first_name}},

A quick reminder about your upcoming booking with {{shop_name}}:

{{service_name}}
{{scheduled_date}} at {{scheduled_time}}
Vehicle: {{vehicle_label}}
Where: {{location_type}}
Estimated: {{price_estimate}}

If anything's changed, reply to this email.

{{shop_name}}`,
  },
  {
    key: "booking-update",
    subject: "Booking update — {{service_name}} on {{scheduled_date}}",
    body: `Hi {{first_name}},

Heads up — there's been a change to your booking:

{{update_summary}}

Updated details:
{{service_name}}
{{scheduled_date}} at {{scheduled_time}}
Vehicle: {{vehicle_label}}
Where: {{location_type}}
Estimated: {{price_estimate}}

If anything looks off, reply and we'll fix it.

{{shop_name}}`,
  },
  {
    key: "booking-team-notification",
    subject: "New booking: {{service_name}} on {{scheduled_date}} at {{scheduled_time}}",
    body: `A new booking has been created in the CRM.

Customer: {{customer_name}}
Email: {{customer_email}}
Phone: {{customer_phone}}

{{service_name}}
{{scheduled_date}} at {{scheduled_time}}
Vehicle: {{vehicle_label}}
Where: {{location_type}}
Estimated: {{price_estimate}}

Notes:
{{notes}}

Review in the CRM if any prep or follow-up is required.`,
  },
];

async function main() {
  const supabase = getSupabaseAdminClient();
  const { data: shop } = await supabase.from("shops").select("id").eq("slug", "christchurch").single();
  if (!shop) throw new Error("christchurch not found");

  for (const t of TEMPLATES) {
    const { error } = await supabase
      .from("email_templates")
      .update({ subject_template: t.subject, body_template: t.body })
      .eq("shop_id", shop.id)
      .eq("key", t.key);
    if (error) throw error;
    console.log(`✓ updated christchurch/${t.key}`);
  }

  console.log("\nNow run: npx tsx scripts/sync-shop-templates.ts --apply");
}

main().catch((e) => { console.error(e); process.exit(1); });
