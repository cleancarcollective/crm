import { addMinutes } from "date-fns";
import { fromZonedTime } from "date-fns-tz";

import { cleanString, normalizeEmail, normalizePhone, normalizeRego, parseNumber } from "@/lib/bookingIntake/normalize";
import type {
  BookingIntakePayload,
  BookingIntakeValidationError,
  NormalizedBookingPayload
} from "@/lib/bookingIntake/types";

function buildFullName(payload: BookingIntakePayload) {
  const preferred = cleanString(payload["New Client Name"]);
  if (preferred) {
    return preferred;
  }

  const first = cleanString(payload.first_name);
  const last = cleanString(payload.last_name);
  const composed = [first, last].filter(Boolean).join(" ").trim();

  return composed || null;
}

function getScheduledStart(date: string, time: string, timezone: string) {
  return fromZonedTime(`${date} ${time}`, timezone);
}

export function mapBookingPayload(
  payload: BookingIntakePayload,
  options: { defaultShopSlug?: string; timezone?: string } = {}
):
  | { success: true; data: NormalizedBookingPayload }
  | { success: false; errors: BookingIntakeValidationError[] } {
  const errors: BookingIntakeValidationError[] = [];

  const shopSlug = cleanString((payload.shop_slug as string | undefined) ?? options.defaultShopSlug ?? "christchurch");
  if (!shopSlug) {
    errors.push({ field: "shop_slug", message: "Missing shop slug." });
  }

  const email = cleanString(payload["New Lead/Client Email"]) ?? cleanString(payload.email);
  const phone = cleanString(payload["New Lead/Client Phone"]) ?? cleanString(payload.phone);
  if (!email && !phone) {
    errors.push({ field: "contact", message: "Provide at least an email or phone number." });
  }

  const serviceName = cleanString(payload["Service Name"]) ?? cleanString(payload.Title);
  if (!serviceName) {
    errors.push({ field: "service_name", message: "Missing service name." });
  }

  const appointmentDate = cleanString(payload.appointment_date) ?? cleanString(payload["Event Date"]);
  if (!appointmentDate) {
    errors.push({ field: "appointment_date", message: "Missing appointment date." });
  }

  const appointmentTime = cleanString(payload.appointment_time) ?? cleanString(payload["Event Time"]);
  if (!appointmentTime) {
    errors.push({ field: "appointment_time", message: "Missing appointment time." });
  }

  const durationMinutesValue = parseNumber(payload.duration_minutes ?? payload["Duration (minutes)"]);
  if (
    payload.duration_minutes !== undefined ||
    payload["Duration (minutes)"] !== undefined
  ) {
    if (durationMinutesValue === null || durationMinutesValue < 0) {
      errors.push({ field: "duration_minutes", message: "Duration must be a valid non-negative number." });
    }
  }

  if (errors.length > 0 || !shopSlug || !serviceName || !appointmentDate || !appointmentTime) {
    return { success: false, errors };
  }

  const timezone = options.timezone ?? "Pacific/Auckland";
  const scheduledStartDate = getScheduledStart(appointmentDate, appointmentTime, timezone);

  if (Number.isNaN(scheduledStartDate.getTime())) {
    return {
      success: false,
      errors: [{ field: "scheduled_start", message: "Appointment date/time could not be parsed." }]
    };
  }

  const scheduledEndDate =
    durationMinutesValue !== null ? addMinutes(scheduledStartDate, durationMinutesValue) : null;

  return {
    success: true,
    data: {
      shopSlug,
      contact: {
        firstName: cleanString(payload.first_name),
        lastName: cleanString(payload.last_name),
        fullName: buildFullName(payload),
        email,
        normalizedEmail: normalizeEmail(email),
        phone,
        normalizedPhone: normalizePhone(phone)
      },
      vehicle: {
        make: cleanString(payload["Vehicle Make"]) ?? cleanString(payload.vehicle_make),
        model: cleanString(payload["Vehicle Model"]) ?? cleanString(payload.vehicle_model),
        year: cleanString(payload["Vehicle Year"]) ?? cleanString(payload.vehicle_year),
        rego: cleanString(payload.rego),
        normalizedRego: normalizeRego(payload.rego),
        size: cleanString(payload.vehicle_size),
        notes: null
      },
      booking: {
        bookingSource: cleanString(payload.source) ?? "Website Booking Flow",
        serviceName,
        serviceDetails: cleanString(payload.Details) ?? cleanString(payload.notes),
        scheduledStart: scheduledStartDate.toISOString(),
        scheduledEnd: scheduledEndDate ? scheduledEndDate.toISOString() : null,
        status: "confirmed",
        priceEstimate: parseNumber(payload.total_price ?? payload.Price),
        notes: cleanString(payload.user_notes) ?? cleanString(payload.notes),
        serviceId: cleanString(payload["Service ID"]) ?? cleanString(payload.service_ids),
        durationMinutes: durationMinutesValue,
        locationType: cleanString(payload.location_type),
        rawPayload: payload
      }
    }
  };
}
