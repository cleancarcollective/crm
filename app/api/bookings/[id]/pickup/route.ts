import { NextResponse } from "next/server";

import { requireCurrentShop } from "@/lib/auth/currentShop";
import { getBookingWithRelationsById, getShopById, getVehicleLabel } from "@/lib/dashboard/bookings";
import { sendPickupReadyEmail } from "@/lib/email/sendPickupReadyEmail";
import { schedulePostDetailTouchpoints } from "@/lib/bookings/postDetailTouchpoints";
import { scheduleReviewSms } from "@/lib/sms/scheduledSmsJobs";
import { loadAndRenderSms } from "@/lib/sms/smsTemplateRenderer";
import { sendTnzSms } from "@/lib/sms/tnzClient";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const currentShop = await requireCurrentShop();
  const supabase = getSupabaseAdminClient();

  // Fetch booking record — scoped to the user's shop so a CHC user can't
  // trigger a pickup notification on a Wellington booking by guessing the id.
  const { data: bookingRecord, error: fetchError } = await supabase
    .from("bookings")
    .select("id, shop_id, contact_id")
    .eq("id", id)
    .eq("shop_id", currentShop.id)
    .single();

  if (fetchError || !bookingRecord) {
    return NextResponse.json({ success: false, error: "Booking not found." }, { status: 404 });
  }

  const [shop, booking] = await Promise.all([
    getShopById(bookingRecord.shop_id),
    getBookingWithRelationsById(id, bookingRecord.shop_id),
  ]);

  if (!booking) {
    return NextResponse.json({ success: false, error: "Booking with relations not found." }, { status: 404 });
  }

  const customerEmail = booking.contact?.email ?? null;
  const customerPhone = booking.contact?.phone ?? null;
  const firstName = booking.contact?.first_name ?? booking.contact?.full_name?.split(" ")[0] ?? "there";
  const vehicleLabel = getVehicleLabel(booking);

  // Send pickup ready email (if customer has an email)
  let emailResult: { sent: boolean; afterHours: boolean } = { sent: false, afterHours: false };
  if (customerEmail) {
    try {
      emailResult = await sendPickupReadyEmail({
        shop,
        firstName,
        customerEmail,
        vehicleLabel,
        bookingId: id,
        contactId: bookingRecord.contact_id ?? null,
      });
    } catch (err) {
      console.error("Pickup email failed", { bookingId: id, err });
    }
  }

  // Send pickup ready SMS (if customer has a phone)
  let smsResult: { sent: boolean; error?: string } = { sent: false };
  if (customerPhone) {
    const { body: smsMessage } = await loadAndRenderSms(
      bookingRecord.shop_id,
      emailResult.afterHours ? "pickup_after_hours" : "pickup_normal",
      {
        name: firstName,
        vehicle: vehicleLabel ?? "your vehicle",
      }
    );
    const tnzResult = await sendTnzSms(customerPhone, smsMessage);
    smsResult = tnzResult.success
      ? { sent: true }
      : { sent: false, error: tnzResult.error };
  }

  // Update booking status to "completed"
  await supabase
    .from("bookings")
    .update({ status: "completed" })
    .eq("id", id);

  // Schedule review SMS for 23 hours later
  if (customerPhone) {
    try {
      await scheduleReviewSms({
        bookingId: id,
        contactId: bookingRecord.contact_id ?? null,
        shopId: bookingRecord.shop_id,
        phone: customerPhone,
        firstName,
      });
    } catch (err) {
      console.error("Failed to schedule review SMS", { bookingId: id, err });
    }
  }

  // Phase B: schedule the 4-touchpoint recurring-discount nudge series.
  // Idempotent + eligibility-gated inside the helper. Non-fatal.
  try {
    const result = await schedulePostDetailTouchpoints(id);
    console.info("Post-detail touchpoints schedule attempt (pickup)", {
      bookingId: id,
      scheduled: result.scheduled,
      skipped: result.skipped,
    });
  } catch (err) {
    console.error("Failed to schedule post-detail touchpoints (pickup)", { bookingId: id, err });
  }

  console.info("Pick-up ready triggered", { bookingId: id, emailSent: emailResult.sent, smsSent: smsResult.sent, afterHours: emailResult.afterHours });

  return NextResponse.json({
    success: true,
    afterHours: emailResult.afterHours,
    emailSent: emailResult.sent,
    smsSent: smsResult.sent,
    smsError: smsResult.error ?? null,
  });
}
