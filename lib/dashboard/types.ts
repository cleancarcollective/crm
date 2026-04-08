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
  raw_payload: Record<string, unknown>;
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
  created_at: string;
  updated_at: string;
  booked_at: string | null;
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

export type ContactProfile = {
  shop: ShopRecord;
  contact: ContactRecord;
  vehicles: VehicleRecord[];
  leads: LeadWithVehicle[];
  bookings: BookingWithRelations[];
  emails: EmailMessageWithEvents[];
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
