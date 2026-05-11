/**
 * Default SMS template strings. Same pattern as the email templates:
 *   1. Bootstrap an empty sms_templates table via the seed API
 *   2. Used as a code-side fallback when the DB row is missing
 *
 * Variables: {{var}} — substituted at render time. Different templates
 * accept different variables — see SMS_TEMPLATE_VARIABLES below.
 */

export type SmsTemplateKey =
  | "booking_confirmation"
  | "booking_reminder_day"
  | "pickup_normal"
  | "pickup_after_hours"
  | "review_request"
  | "lead_followup_5day";

export type SmsTemplateDefault = {
  template_key: SmsTemplateKey;
  name: string;
  body_text: string;
};

export const SMS_TEMPLATE_DEFAULTS: SmsTemplateDefault[] = [
  {
    template_key: "booking_confirmation",
    name: "Booking confirmation",
    body_text: `Hi {{name}}, your booking is confirmed for {{date_time}}. See you soon! - Clean Car Collective`,
  },
  {
    template_key: "booking_reminder_day",
    name: "Booking reminder — 1 day before",
    body_text: `Hi {{name}}, friendly reminder - your Clean Car Collective booking is tomorrow, {{date_time}}. Reply if anything's changed. See you soon!`,
  },
  {
    template_key: "pickup_normal",
    name: "Pickup ready — during opening hours",
    body_text: `Hi {{name}}, your {{vehicle}} is ready for pick-up! If you'll be more than 30 minutes away, please give us a heads-up. - Clean Car Collective`,
  },
  {
    template_key: "pickup_after_hours",
    name: "Pickup ready — after hours",
    body_text: `Hi {{name}}, your {{vehicle}} is ready for pick-up! We close at 5:00 pm — if you'll be more than 30 mins away please let us know your ETA. - Clean Car Collective`,
  },
  {
    template_key: "review_request",
    name: "Review request — 23h after pickup",
    body_text: `Hey {{name}}, thanks again for choosing Clean Car Collective! We'd love your quick feedback - just tap here: https://cleancarcollective.co.nz/how-did-we-do/`,
  },
  {
    template_key: "lead_followup_5day",
    name: "Lead follow-up SMS — 5 days after estimate",
    body_text: `Hi {{name}}, just checking - any questions about the {{vehicle}} detailing estimate? Reply to this message to lock in a slot or have a chat - {{senderName}}`,
  },
];

export const SMS_TEMPLATE_VARIABLES: Record<SmsTemplateKey, { key: string; label: string }[]> = {
  booking_confirmation: [
    { key: "name", label: "Customer first name" },
    { key: "date_time", label: "Formatted booking date + time" },
  ],
  booking_reminder_day: [
    { key: "name", label: "Customer first name" },
    { key: "date_time", label: "Formatted booking date + time" },
  ],
  pickup_normal: [
    { key: "name", label: "Customer first name" },
    { key: "vehicle", label: "Vehicle label (year + make + model)" },
  ],
  pickup_after_hours: [
    { key: "name", label: "Customer first name" },
    { key: "vehicle", label: "Vehicle label (year + make + model)" },
  ],
  review_request: [
    { key: "name", label: "Customer first name" },
  ],
  lead_followup_5day: [
    { key: "name", label: "Customer first name" },
    { key: "vehicle", label: "Vehicle label" },
    { key: "senderName", label: "Per-shop sender (Ben / Max)" },
  ],
};

export const SMS_TEMPLATE_KEY_LABELS: Record<SmsTemplateKey, string> = {
  booking_confirmation: "Booking Confirmation",
  booking_reminder_day: "Reminder: 1 day before",
  pickup_normal: "Pickup Ready (in hours)",
  pickup_after_hours: "Pickup Ready (after hours)",
  review_request: "Review Request (post-pickup)",
  lead_followup_5day: "Lead Follow-up SMS (5 days)",
};
