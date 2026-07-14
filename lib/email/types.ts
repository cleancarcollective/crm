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
  | "booking-update"
  | "post_detail_recurring_offer_next_day"
  | "post_detail_recurring_offer_6w"
  | "post_detail_recurring_offer_10w"
  | "post_detail_recurring_offer_16w";

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
  add_ons: string;
  update_summary?: string;
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
  shop_website: string;
  // Optional - only populated for team-facing emails
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  // Optional - signed self-service link for customer-facing emails
  manage_booking_url?: string;
  // Optional - promo / discount-code note to render as its own styled
  // callout block, separate from the customer's own notes
  promo_note?: string;
  // Optional - deep link to the booking in the CRM (only on team-facing
  // emails, so staff can jump straight to the record)
  crm_booking_url?: string;
  // Optional - humanised booking source (only on team-facing emails), so
  // staff can tell a website booking from a hand-entered / ad-funnel one
  booking_source?: string;
};

export type RenderedEmail = {
  subject: string;
  textBody: string;
  htmlBody: string;
};
