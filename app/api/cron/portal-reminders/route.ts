/**
 * Daily cron: send detail-due reminder emails for portal_reminders
 * whose next_due_at has arrived, then roll next_due_at forward by the
 * cadence. Authed by CRON_SECRET bearer (same convention as the other
 * cron routes).
 */

import { NextRequest, NextResponse } from "next/server";

import { sendViaGmailSmtp } from "@/lib/email/smtpClient";
import { sendDetailDueEmail } from "@/lib/portal/emails";
import { createMembershipCheckout, stripeConfigured } from "@/lib/portal/stripe";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdminClient();
  // Priority window: fire when now >= next_due_at - notify_days_before.
  // Widest window is 30 days, so pre-filter in SQL to due-within-30d and
  // apply the per-row offset in code.
  const { data: candidates } = await supabase
    .from("portal_reminders")
    .select("id, contact_id, shop_id, vehicle_id, cadence_months, next_due_at, service_name, notify_days_before")
    .eq("status", "active")
    .lte("next_due_at", new Date(Date.now() + 30 * 86400000).toISOString())
    .limit(200);

  const now = Date.now();
  const due = (candidates ?? []).filter((r) => {
    const windowOpens = new Date(r.next_due_at).getTime() - (r.notify_days_before ?? 7) * 86400000;
    return windowOpens <= now;
  }).slice(0, 50);

  if (!due || due.length === 0) {
    return NextResponse.json({ ok: true, sent: 0 });
  }

  let sent = 0;
  const errors: string[] = [];

  for (const reminder of due) {
    try {
      const [{ data: contact }, { data: shop }, { data: vehicle }] = await Promise.all([
        supabase
          .from("contacts")
          .select("id, first_name, email")
          .eq("id", reminder.contact_id)
          .single(),
        supabase.from("shops").select("id, slug, name, timezone").eq("id", reminder.shop_id).single(),
        reminder.vehicle_id
          ? supabase.from("vehicles").select("make, model, year").eq("id", reminder.vehicle_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      if (!contact?.email || !shop) {
        // Orphaned reminder - pause it so we don't retry forever.
        await supabase.from("portal_reminders").update({ status: "paused" }).eq("id", reminder.id);
        continue;
      }

      // Last non-cancelled past booking = "since your last visit" anchor.
      const { data: lastBooking } = await supabase
        .from("bookings")
        .select("scheduled_start")
        .eq("contact_id", contact.id)
        .lte("scheduled_start", new Date().toISOString())
        .neq("status", "cancelled")
        .order("scheduled_start", { ascending: false })
        .limit(1)
        .maybeSingle();

      const vehicleLabel = vehicle
        ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || null
        : null;

      await sendDetailDueEmail({
        email: contact.email,
        firstName: contact.first_name,
        shopId: shop.id,
        shopSlug: shop.slug,
        contactId: contact.id,
        vehicleLabel,
        serviceName: reminder.service_name,
        cadenceMonths: reminder.cadence_months,
        lastVisitAt: lastBooking?.scheduled_start ?? null,
        timezone: shop.timezone,
        dueAt: reminder.next_due_at,
      });

      // Roll forward to the next cycle.
      let next = addMonths(new Date(reminder.next_due_at), reminder.cadence_months);
      while (next.getTime() < Date.now()) next = addMonths(next, reminder.cadence_months);
      await supabase
        .from("portal_reminders")
        .update({
          next_due_at: next.toISOString(),
          last_sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", reminder.id);

      sent += 1;
    } catch (err) {
      console.error("portal reminder send failed", reminder.id, err);
      errors.push(reminder.id);
    }
  }

  const nudged = await nudgeStalledPendingMemberships();

  return NextResponse.json({ ok: true, sent, failed: errors.length, membership_nudges: nudged });
}

/**
 * One automated day-3 reminder for Collective signups that never
 * finished Stripe checkout - the exact people the funnel loses.
 * Single nudge only (nudged_at), then it's the team's call.
 */
async function nudgeStalledPendingMemberships(): Promise<number> {
  const supabase = getSupabaseAdminClient();
  const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
  const { data: stalled } = await supabase
    .from("memberships")
    .select("id, contact_id, size_tier, monthly_fee_cents, monthly_credit_cents")
    .eq("status", "pending")
    .is("nudged_at", null)
    .lt("created_at", threeDaysAgo)
    .limit(20);

  if (!stalled || stalled.length === 0) return 0;

  let nudged = 0;
  for (const m of stalled) {
    try {
      const { data: contact } = await supabase
        .from("contacts")
        .select("first_name, email")
        .eq("id", m.contact_id)
        .single();
      if (!contact?.email) {
        await supabase.from("memberships").update({ nudged_at: new Date().toISOString() }).eq("id", m.id);
        continue;
      }

      let checkoutUrl: string | null = null;
      if (stripeConfigured()) {
        try {
          checkoutUrl = await createMembershipCheckout({
            membershipId: m.id,
            sizeTier: m.size_tier,
            email: contact.email,
          });
        } catch (err) {
          console.error("nudge checkout session failed", m.id, err);
        }
      }
      if (!checkoutUrl) continue; // without a link the nudge is pointless

      const credit = (m.monthly_credit_cents / 100).toFixed(0);
      const fee = (m.monthly_fee_cents / 100).toFixed(0);
      await sendViaGmailSmtp({
        From: "Clean Car Collective <hello@cleancarcollective.co.nz>",
        To: contact.email,
        Subject: `Your $${credit} monthly credit is still waiting`,
        TextBody: `${contact.first_name ? `Hi ${contact.first_name},` : "Hi,"}

Quick one - your Collective membership is a 2-minute setup away:

${checkoutUrl}

Once it's live, $${credit} of detailing credit lands every month for $${fee} +GST, never expires, and stacks if you get busy - a couple of quiet months turns into a bigger detail.

Cancel anytime; banked credit stays yours. If you've changed your mind, just ignore this - no charge, nothing to cancel.`,
        HtmlBody: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;">
<p>${contact.first_name ? `Hi ${contact.first_name},` : "Hi,"}</p>
<p>Quick one - your Collective membership is a 2-minute setup away.</p>
<p style="margin:22px 0;"><a href="${checkoutUrl}" style="display:inline-block;padding:14px 34px;background:#1a1713;color:#ffffff;font-weight:600;text-decoration:none;border-radius:12px;">Switch on my credit</a></p>
<p>Once it's live, <strong>$${credit} of detailing credit</strong> lands every month for $${fee} +GST, never expires, and stacks if you get busy - a couple of quiet months turns into a bigger detail.</p>
<p style="color:#6f6860;font-size:13px;">Cancel anytime; banked credit stays yours. If you've changed your mind, just ignore this - no charge, nothing to cancel.</p>
</div>`,
        Metadata: { template_key: "collective-pending-nudge", membership_id: m.id },
      });

      await supabase.from("memberships").update({ nudged_at: new Date().toISOString() }).eq("id", m.id);
      nudged += 1;
    } catch (err) {
      console.error("pending membership nudge failed", m.id, err);
    }
  }
  return nudged;
}
