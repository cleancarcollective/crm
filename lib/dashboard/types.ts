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
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
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

export type CalendarDaySummary = {
  isoDate: string;
  isCurrentMonth: boolean;
  isToday: boolean;
  bookingCount: number;
  totalRevenue: number;
  totalDurationMinutes: number;
  bookings: BookingWithRelations[];
};
