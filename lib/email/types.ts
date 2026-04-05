export type EmailTemplateRecord = {
  id: string;
  shop_id: string;
  key: string;
  name: string;
  subject_template: string;
  body_template: string;
  is_active: boolean;
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
};

export type RenderedEmail = {
  subject: string;
  body: string;
};
