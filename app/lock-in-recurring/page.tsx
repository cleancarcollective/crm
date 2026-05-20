/**
 * Public customer-facing recurring lock-in page (Phase C of recurring-discounts).
 *
 * URL shape: /lock-in-recurring?token=<signed>&cadence=<2|3|4>
 *
 * Linked from the post-detail touchpoint emails / SMS (see
 * lib/email/sendPostDetailOffer.ts). Token action='lock_in_recurring',
 * 30-day expiry, single-use (consumed after a successful lock-in).
 *
 * Customer sees their previous completed booking, picks a cadence (preselected
 * from the URL cadence param), picks a start date, and confirms — server
 * creates a booking_series with discount_source='post_detail_offer' and
 * cancels any remaining touchpoints for the contact.
 */

import { formatInTimeZone } from "date-fns-tz";
import { notFound } from "next/navigation";

import { LockInRecurringClient } from "@/components/dashboard/LockInRecurringClient";
import { verifyActionToken } from "@/lib/auth/signedTokens";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

type CadenceMonths = 2 | 3 | 4;

function discountForCadence(months: CadenceMonths): number {
  // Mirrors the table in docs/recurring-discounts-plan.md.
  if (months === 2) return 15;
  if (months === 3) return 10;
  return 5;
}

function parseCadenceParam(raw: string | undefined): CadenceMonths {
  const n = Number(raw);
  if (n === 2 || n === 3 || n === 4) return n;
  // Default to the headline 15%/2-month tier when no param is supplied.
  return 2;
}

export default async function LockInRecurringPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; cadence?: string }>;
}) {
  const { token, cadence } = await searchParams;

  if (!token) {
    return (
      <main className="leadActionShell">
        <div className="leadActionCard leadActionCard--err">
          <div className="leadActionEmoji">⚠️</div>
          <h1>Missing token</h1>
          <p>This page needs a valid lock-in link from your follow-up email or text.</p>
        </div>
      </main>
    );
  }

  const verify = await verifyActionToken(token, {
    requireAction: "lock_in_recurring",
    checkConsumed: true,
  });
  if (!verify.ok) {
    const reasons: Record<string, string> = {
      malformed: "This link is malformed.",
      bad_signature: "This link couldn't be verified.",
      expired: "This link has expired. Reply to one of our emails and we'll sort you a fresh one.",
      consumed: "This link has already been used. You're locked in.",
    };
    return (
      <main className="leadActionShell">
        <div className="leadActionCard leadActionCard--err">
          <div className="leadActionEmoji">⚠️</div>
          <h1>Link issue</h1>
          <p>{reasons[verify.reason] ?? "Something's wrong with this link."}</p>
          <p className="leadActionFoot">Reply to one of our emails and we'll help you out.</p>
        </div>
      </main>
    );
  }

  const supabase = getSupabaseAdminClient();
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, shop_id, series_id, service_name, scheduled_start, scheduled_end, duration_minutes, location_type, service_address, service_details, size, price_estimate, vehicle_id, contact_id, contact:contacts(first_name), vehicle:vehicles(make, model, year, rego)")
    .eq("id", verify.payload.r)
    .eq("shop_id", verify.payload.s)
    .maybeSingle();

  if (!booking) notFound();

  const { data: shop } = await supabase
    .from("shops")
    .select("id, name, slug, timezone")
    .eq("id", booking.shop_id)
    .maybeSingle();

  if (!shop) notFound();

  // Already part of a series → don't let them double-up.
  if (booking.series_id) {
    return (
      <main className="leadActionShell">
        <div className="leadActionCard leadActionCard--info">
          <div className="leadActionEmoji">✅</div>
          <h1>You're already on a recurring rate</h1>
          <p>This booking is part of a recurring series. If you'd like to adjust your cadence or pause it, reply to your confirmation email and we'll sort it.</p>
        </div>
      </main>
    );
  }

  const contact = booking.contact as unknown as { first_name: string | null } | null;
  const vehicle = booking.vehicle as unknown as { make: string | null; model: string | null; year: number | null; rego: string | null } | null;

  const vehicleLabel = vehicle
    ? [vehicle.year ? String(vehicle.year) : null, vehicle.make, vehicle.model]
        .filter(Boolean)
        .join(" ") || vehicle.rego || "your vehicle"
    : "your vehicle";

  const scheduledLabel = formatInTimeZone(
    booking.scheduled_start,
    shop.timezone,
    "EEEE d MMMM yyyy 'at' h:mm a"
  );

  const initialCadence = parseCadenceParam(cadence);

  // Derive a default start date in the shop's timezone: today + (cadence months).
  // We render the YYYY-MM-DD string in shop-local time so the date input lines
  // up with what the customer sees on their calendar at home.
  const now = new Date();
  const monthsAhead = new Date(now);
  monthsAhead.setMonth(monthsAhead.getMonth() + initialCadence);
  const defaultStartDate = formatInTimeZone(monthsAhead, shop.timezone, "yyyy-MM-dd");
  const defaultStartTime = formatInTimeZone(booking.scheduled_start, shop.timezone, "HH:mm");

  // Per-cadence pricing for the picker — server is source of truth on price.
  const basePrice = booking.price_estimate ?? null;
  const cadenceOptions = [2, 3, 4].map((m) => {
    const months = m as CadenceMonths;
    const discount = discountForCadence(months);
    const discounted = basePrice != null
      ? Math.round(basePrice * (1 - discount / 100) * 100) / 100
      : null;
    return { months, discount, price: discounted };
  });

  return (
    <LockInRecurringClient
      token={token}
      shop={{ name: shop.name, slug: shop.slug }}
      firstName={contact?.first_name ?? "there"}
      booking={{
        id: booking.id,
        service_name: booking.service_name,
        scheduled_label: scheduledLabel,
        vehicle_label: vehicleLabel,
        base_price: basePrice,
      }}
      initialCadence={initialCadence}
      cadenceOptions={cadenceOptions}
      defaultStartDate={defaultStartDate}
      defaultStartTime={defaultStartTime}
    />
  );
}
