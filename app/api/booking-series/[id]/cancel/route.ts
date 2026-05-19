/**
 * POST /api/booking-series/[id]/cancel
 *
 * Staff-only. Cancels a recurring series and all future non-overridden
 * bookings, cancels pending reminders for those bookings, then emails the
 * customer + team. Customer self-service uses /api/public/booking-action
 * with scope='series' instead — both share lib/bookings/cancelSeries.ts.
 */

import { NextResponse } from "next/server";

import { requireCurrentShop } from "@/lib/auth/currentShop";
import { cancelSeriesCore } from "@/lib/bookings/cancelSeries";
import {
  sendSeriesCancelCustomerEmail,
  sendSeriesCancelTeamNotification,
} from "@/lib/email/sendSeriesEditCancelEmails";

type Body = {
  scope?: "series";
  reason?: string | null;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    body = {};
  }
  if (body.scope && body.scope !== "series") {
    return NextResponse.json({ ok: false, error: "Invalid scope." }, { status: 400 });
  }
  const reason = (body.reason ?? "").trim() || null;

  const currentShop = await requireCurrentShop();
  const result = await cancelSeriesCore({
    seriesId: id,
    shopId: currentShop.id,
    reason,
    actor: "staff",
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  // Emails — non-fatal. Cancellation is already committed in the DB.
  try {
    await sendSeriesCancelCustomerEmail({
      shopId: currentShop.id,
      seriesId: id,
      serviceName: result.series.service_name,
      remainingCancelled: result.bookingsCancelled,
      reason,
      customerEmail: result.contact?.email ?? null,
      customerFirstName: result.contact?.firstName ?? null,
    });
  } catch (err) {
    console.error("Series cancel customer email failed (non-fatal)", { seriesId: id, err });
  }
  try {
    await sendSeriesCancelTeamNotification({
      shopId: currentShop.id,
      seriesId: id,
      serviceName: result.series.service_name,
      remainingCancelled: result.bookingsCancelled,
      reason,
      customerName: result.contact?.fullName ?? null,
      customerEmail: result.contact?.email ?? null,
    });
  } catch (err) {
    console.error("Series cancel team notification failed (non-fatal)", { seriesId: id, err });
  }

  return NextResponse.json({ ok: true, bookingsCancelled: result.bookingsCancelled });
}
