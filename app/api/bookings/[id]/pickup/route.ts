import { NextResponse } from "next/server";

import { getBookingWithRelationsById, getShopById, getVehicleLabel } from "@/lib/dashboard/bookings";
import { sendPickupReadyEmail } from "@/lib/email/sendPickupReadyEmail";
import { scheduleReviewSms } from "@/lib/sms/scheduledSmsJobs";
import { sendTnzSms } from "@/lib/sms/tnzClient";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

function buildPickupSmsMessage(firstName: string, vehicleLabel: string | null, afterHours: boolean): string {
  const vehicle = vehicleLabel ?? "your vehicle";
  if (afterHours) {
    return `Hi ${firstName}, ${vehicle} is ready for pick-up! We close at 5:00 pm — if you'll be more than 30 mins away please let us know your ETA. - Clean Car Collective`;
  }
  return `Hi ${firstName}, ${vehicle} is ready for pick-up! If you'll be more than 30 minutes away, please give us a heads-up. - Clean Car Collective`;
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = getSupabaseAdminClient();

  // Fetch booking record to get shop_id
  const { data: bookingRecord, error: fetchError } = await supabase
    .from("bookings")
    .select("id, shop_id, contact_id")
    .eq("id", id)
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
    const smsMessage = buildPickupSmsMessage(firstName, vehicleLabel, emailResult.afterHours);
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

  console.info("Pick-up ready triggered", { bookingId: id, emailSent: emailResult.sent, smsSent: smsResult.sent, afterHours: emailResult.afterHours });

  return NextResponse.json({
    success: true,
    afterHours: emailResult.afterHours,
    emailSent: emailResult.sent,
    smsSent: smsResult.sent,
    smsError: smsResult.error ?? null,
  });
}
