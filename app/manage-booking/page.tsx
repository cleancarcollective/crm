/**
 * Public customer-facing booking management page.
 *
 * URL shape: /manage-booking?token=<signed>
 *
 * The token authorises the bearer to view + modify ONE specific booking.
 * No login required. Token validates: signature, expiry, action ='manage_booking',
 * and the resource_id matches the current booking.
 *
 * Customer can:
 *   - View booking details
 *   - Submit a reschedule request (saves the requested new time as a
 *     pending change — staff confirm via the CRM, sends a booking_update
 *     email with the new time)
 *   - Cancel the booking (immediate)
 */

import { formatInTimeZone } from "date-fns-tz";
import { notFound, redirect } from "next/navigation";

import { ManageBookingClient } from "@/components/dashboard/ManageBookingClient";
import { verifyActionToken } from "@/lib/auth/signedTokens";
import { isRetiredShop, retiredShopManageBookingUrl } from "@/lib/shops/retired";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export default async function ManageBookingPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <main className="leadActionShell">
        <div className="leadActionCard leadActionCard--err">
          <div className="leadActionEmoji">⚠️</div>
          <h1>Missing token</h1>
          <p>This page needs a valid booking management link from your confirmation email.</p>
        </div>
      </main>
    );
  }

  const verify = await verifyActionToken(token, { requireAction: "manage_booking" });
  if (!verify.ok) {
    const reasons: Record<string, string> = {
      malformed: "This link is malformed.",
      bad_signature: "This link couldn't be verified.",
      expired: "This link has expired. Reply to your booking confirmation email and we'll sort it.",
      consumed: "This link has already been used.",
    };
    return (
      <main className="leadActionShell">
        <div className="leadActionCard leadActionCard--err">
          <div className="leadActionEmoji">⚠️</div>
          <h1>Link issue</h1>
          <p>{reasons[verify.reason] ?? "Something's wrong with this link."}</p>
          <p className="leadActionFoot">Reply to your booking confirmation email and we'll help you out.</p>
        </div>
      </main>
    );
  }

  const supabase = getSupabaseAdminClient();
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, shop_id, series_id, service_name, scheduled_start, scheduled_end, duration_minutes, location_type, status, contact:contacts(first_name)")
    .eq("id", verify.payload.r)
    .eq("shop_id", verify.payload.s)
    .maybeSingle();

  if (!booking) notFound();

  const { data: shop } = await supabase
    .from("shops")
    .select("name, slug, timezone")
    .eq("id", booking.shop_id)
    .maybeSingle();

  if (!shop) notFound();

  // Shop has moved to its own CRM: this database's copy of the booking is
  // frozen, so send the customer to the same booking on the new system.
  if (isRetiredShop(shop.slug)) {
    const movedUrl = retiredShopManageBookingUrl(booking.id as string, booking.shop_id as string);
    // External URL: typed routes only know this app's own paths.
    if (movedUrl) redirect(movedUrl as Parameters<typeof redirect>[0]);
    return (
      <main className="leadActionShell">
        <div className="leadActionCard leadActionCard--info">
          <div className="leadActionEmoji">ℹ️</div>
          <h1>We&apos;ve moved to a new booking system</h1>
          <p>To change or cancel this booking, reply to your booking confirmation email and we&apos;ll sort it for you.</p>
        </div>
      </main>
    );
  }

  // Already-cancelled booking → show tombstone
  if (booking.status === "cancelled") {
    return (
      <main className="leadActionShell">
        <div className="leadActionCard leadActionCard--info">
          <div className="leadActionEmoji">ℹ️</div>
          <h1>Booking cancelled</h1>
          <p>This booking has already been cancelled. If you'd like to rebook, reply to your confirmation email or visit our website.</p>
        </div>
      </main>
    );
  }

  // Already-completed → no actions
  if (booking.status === "completed") {
    return (
      <main className="leadActionShell">
        <div className="leadActionCard leadActionCard--info">
          <div className="leadActionEmoji">✅</div>
          <h1>Already completed</h1>
          <p>This booking has been completed. Thanks for choosing Clean Car Collective!</p>
        </div>
      </main>
    );
  }

  const contact = booking.contact as unknown as { first_name: string } | null;

  return (
    <ManageBookingClient
      token={token}
      booking={{
        id: booking.id,
        series_id: booking.series_id ?? null,
        service_name: booking.service_name,
        scheduled_start: booking.scheduled_start,
        scheduled_end: booking.scheduled_end,
        duration_minutes: booking.duration_minutes,
        location_type: booking.location_type,
        status: booking.status,
        scheduled_label: formatInTimeZone(
          booking.scheduled_start,
          shop.timezone,
          "EEEE d MMMM yyyy 'at' h:mm a"
        ),
      }}
      shop={{ name: shop.name, slug: shop.slug }}
      firstName={contact?.first_name ?? "there"}
    />
  );
}
