import { addMinutes } from "date-fns";
import { NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

type BookingUpdatePayload = {
  service_name?: string;
  status?: string;
  scheduled_start?: string;
  duration_minutes?: number | null;
  price_estimate?: number | null;
  location_type?: string | null;
  notes?: string | null;
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let payload: BookingUpdatePayload;

  try {
    payload = (await request.json()) as BookingUpdatePayload;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON payload." }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  const { data: existingBooking, error: fetchError } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchError || !existingBooking) {
    return NextResponse.json({ success: false, error: "Booking not found." }, { status: 404 });
  }

  const scheduledStart = payload.scheduled_start ?? existingBooking.scheduled_start;
  const durationMinutes = payload.duration_minutes ?? existingBooking.duration_minutes;
  const updateData = {
    service_name: payload.service_name ?? existingBooking.service_name,
    status: payload.status ?? existingBooking.status,
    scheduled_start: scheduledStart,
    scheduled_end:
      scheduledStart && durationMinutes
        ? addMinutes(new Date(scheduledStart), durationMinutes).toISOString()
        : null,
    duration_minutes: durationMinutes,
    price_estimate: payload.price_estimate ?? existingBooking.price_estimate,
    location_type: payload.location_type ?? existingBooking.location_type,
    notes: payload.notes ?? existingBooking.notes
  };

  const { data: booking, error: updateError } = await supabase
    .from("bookings")
    .update(updateData)
    .eq("id", id)
    .select("*")
    .single();

  if (updateError) {
    return NextResponse.json({ success: false, error: "Failed to update booking." }, { status: 500 });
  }

  return NextResponse.json({ success: true, booking });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = getSupabaseAdminClient();

  const { error } = await supabase.from("bookings").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ success: false, error: "Failed to delete booking." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
