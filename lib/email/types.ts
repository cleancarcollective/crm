export type EmailTemplateRecord = {
  id: string;
  shop_id: string;
  key: string;
  name: string;
  subject_template: string;
  body_template: string;
  is_active: boolean;
};

export type EmailTemplateKey =
  | "booking-confirmation"
  | "booking-team-notification"
  | "booking-reminder-week"
  | "booking-reminder-day"
  | "booking-reminder-hour"
  | "booking-update";

export type ScheduledEmailJobRecord = {
  id: string;
  shop_id: string;
  booking_id: string | null;
  contact_id: string | null;
  template_key: EmailTemplateKey;
  scheduled_for: string;
  status: "pending" | "processing" | "sent" | "cancelled" | "failed" | "skipped";
  email_message_id: string | null;
  attempt_count: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type BookingConfirmationEmailContext = {
  first_name: string;
  full_name: string;
  service_name: string;
  scheduled_date: string;
  scheduled_time: string;
  vehicle_label: string;
  location_type: string;
  price_estimate: string;
  notes: string;
  intro_line: string;
  action_line: string;
  shop_name: string;
  shop_address: string;
  shop_map_link: string;
  shop_phone: string;
  shop_email: string;
  // Optional — only populated for team-facing emails
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
};

export type RenderedEmail = {
  subject: string;
  textBody: string;
  htmlBody: string;
};
