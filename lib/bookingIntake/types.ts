export type BookingIntakePayload = {
  "Event Date"?: string;
  "Event Time"?: string;
  Title?: string;
  Details?: string;
  Price?: number | string;
  "Duration (minutes)"?: number | string;
  "New Client Name"?: string;
  "New Lead/Client Email"?: string;
  "New Lead/Client Phone"?: string;
  "Vehicle Year"?: string;
  "Vehicle Make"?: string;
  "Vehicle Model"?: string;
  source?: string;
  timestamp?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  vehicle_year?: string;
  vehicle_make?: string;
  vehicle_model?: string;
  vehicle_make_model?: string;
  vehicle_size?: string;
  appointment_date?: string;
  appointment_time?: string;
  location_type?: string;
  address?: string;
  delivery_address?: string;
  notes?: string;
  user_notes?: string;
  services_array?: string[];
  service_ids?: string;
  total_price?: number | string;
  duration_minutes?: number | string;
  "Service Name"?: string;
  "Service ID"?: string;
  "Event Address"?: string;
  rego?: string;
  // Google Ads attribution — captured by booking iframe from URL params
  // forwarded by the host WordPress page. Lets us attribute direct bookings
  // (no preceding lead form submission) back to the originating ad click.
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  landing_url?: string;
  [key: string]: unknown;
};

export type BookingIntakeValidationError = {
  field: string;
  message: string;
};

export type NormalizedContactInput = {
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  email: string | null;
  normalizedEmail: string | null;
  phone: string | null;
  normalizedPhone: string | null;
};

export type NormalizedVehicleInput = {
  make: string | null;
  model: string | null;
  year: string | null;
  rego: string | null;
  normalizedRego: string | null;
  size: string | null;
  notes: string | null;
};

export type NormalizedBookingInput = {
  bookingSource: string;
  serviceName: string;
  serviceDetails: string | null;
  scheduledStart: string;
  scheduledEnd: string | null;
  status: "confirmed";
  priceEstimate: number | null;
  notes: string | null;
  serviceId: string | null;
  durationMinutes: number | null;
  locationType: string | null;
  /** Customer service address — only set for mobile bookings. Comes from the
   *  booking-form payload `address` or `service_address` field. */
  serviceAddress: string | null;
  /** Promo / discount code from the booking form. Resolved server-side via
   *  lib/bookingIntake/promoCodes — invalid codes are silently dropped. */
  promoCode: string | null;
  // Google Ads attribution forwarded with the booking — used by the offline
  // conversion export so direct bookings (no preceding lead) still get
  // gclid attribution.
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  landingUrl: string | null;
  rawPayload: BookingIntakePayload;
};

export type NormalizedBookingPayload = {
  shopSlug: string;
  contact: NormalizedContactInput;
  vehicle: NormalizedVehicleInput;
  booking: NormalizedBookingInput;
};
