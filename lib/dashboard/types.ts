export type ShopRecord = {
  id: string;
  slug: string;
  name: string;
  timezone: string;
};

export type BookingRecord = {
  id: string;
  shop_id: string;
  contact_id: string | null;
  vehicle_id: string | null;
  booking_source: string;
  service_name: string;
  service_details: string | null;
  scheduled_start: string;
  scheduled_end: string | null;
  status: string;
  price_estimate: number | null;
  notes: string | null;
  service_id: string | null;
  duration_minutes: number | null;
  location_type: string | null;
  /** Customer service address (mobile bookings). Empty for shop bookings. */
  service_address: string | null;
  raw_payload: Record<string, unknown>;
  /** Set when this booking was generated from a recurring booking_series. */
  series_id: string | null;
  series_sequence: number | null;
  series_overridden: boolean;
  created_at: string;
  updated_at: string;
};

export type ContactRecord = {
  id: string;
  shop_id?: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
};

export type VehicleRecord = {
  id: string;
  make: string | null;
  model: string | null;
  year: string | null;
  rego: string | null;
  size: string | null;
};

export type BookingWithRelations = BookingRecord & {
  contact: ContactRecord | null;
  vehicle: VehicleRecord | null;
};

export type BookingSeriesRecord = {
  id: string;
  shop_id: string;
  contact_id: string;
  vehicle_id: string | null;
  service_name: string;
  service_details: string | null;
  size: string | null;
  price_estimate: number | null;
  duration_minutes: number | null;
  location_type: string | null;
  service_address: string | null;
  notes: string | null;
  booking_source: string;
  /** Recurrence rule. */
  frequency: "days" | "weeks" | "months_nth_weekday";
  interval_count: number;
  nth_week_of_month: number | null;
  day_of_week: number | null;
  first_occurrence_at: string;
  timezone: string;
  end_type: "never" | "after_n" | "on_date";
  end_after_n: number | null;
  end_on_date: string | null;
  status: "active" | "paused" | "cancelled";
  /** Regen / horizon bookkeeping written by lib/bookings/series.ts. */
  generated_through_date: string | null;
  last_regen_at: string | null;
  last_regen_error: string | null;
  created_by_user_id: string | null;
  series_source: string | null;
  created_at: string;
  updated_at: string;
};

export type LeadRecord = {
  id: string;
  shop_id: string;
  contact_id: string | null;
  vehicle_id: string | null;
  source: string;
  source_detail: string | null;
  service_requested: string | null;
  notes: string | null;
  status: string;
  won_source: string | null;
  // Auto-respond fields
  template_key: string | null;
  suggested_size: string | null;
  confidence: string | null;
  reason_code: string | null;
  canonical_key: string | null;
  quote_subject: string | null;
  quote_body: string | null;
  quote_html: string | null;
  internal_notes: string | null;
  approved_size: string | null;
  created_at: string;
  updated_at: string;
  booked_at: string | null;
  // Google Ads attribution captured at lead intake. Used to upload offline
  // conversion values back to Google Ads when a booking completes.
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  landing_url: string | null;
  // Sales-disposition + cool-down state (drives the LeadDispositionActions UI)
  last_disposition: string | null;
  last_disposition_at: string | null;
  cooldown_until: string | null;
  cooldown_reason: string | null;
};

export type LeadWithVehicle = LeadRecord & {
  vehicle: VehicleRecord | null;
};

export type EmailEventRecord = {
  id: string;
  email_message_id: string;
  event_type: string;
  event_timestamp: string;
  metadata_json: Record<string, unknown>;
  created_at: string;
};

export type EmailMessageRecord = {
  id: string;
  shop_id: string;
  contact_id: string | null;
  lead_id: string | null;
  booking_id: string | null;
  template_id: string | null;
  provider_message_id: string | null;
  subject: string;
  body_rendered: string;
  status: string;
  sent_at: string | null;
  created_at: string;
};

export type EmailMessageWithEvents = EmailMessageRecord & {
  events: EmailEventRecord[];
};

export type CustomerCreditRecord = {
  id: string;
  shop_id: string;
  contact_id: string;
  credit_type: string;
  service_name: string;
  description: string | null;
  source: string;
  source_booking_id: string | null;
  redeemed: boolean;
  redeemed_booking_id: string | null;
  redeemed_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ContactProfile = {
  shop: ShopRecord;
  contact: ContactRecord;
  vehicles: VehicleRecord[];
  leads: LeadWithVehicle[];
  bookings: BookingWithRelations[];
  emails: EmailMessageWithEvents[];
  /** Outstanding (not redeemed) customer credits — vouchers, free services
   *  owed via promo codes, etc. Display prominently on the profile so
   *  staff remember to redeem them. */
  credits: CustomerCreditRecord[];
};

export type LeadDirectoryEntry = {
  contact: ContactRecord;
  latestLead: LeadWithVehicle;
  leadCount: number;
};

export type ClientDirectoryEntry = {
  contact: ContactRecord;
  latestBooking: BookingWithRelations;
  bookingCount: number;
  totalRevenue: number;
};

export type CalendarDaySummary = {
  isoDate: string;
  isCurrentMonth: boolean;
  isToday: boolean;
  bookingCount: number;
  totalRevenue: number;
  totalDurationMinutes: number;
  bookings: BookingWithRelations[];
};
