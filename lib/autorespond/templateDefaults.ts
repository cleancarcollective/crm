/**
 * Default template seeds. Used to:
 *   1. Bootstrap the email_templates table if empty (via seed API)
 *   2. Fall back when a DB template is missing (during migration)
 *
 * Template syntax: {{variable_name}} — replaced at render time.
 * Available variables per template key:
 *   inside_out:      name, vehicle, deluxe_price, premium_price
 *   interior_only:   name, vehicle, deluxe_interior_price, premium_interior_price
 *   exterior_only:   name, vehicle, deluxe_exterior_price, premium_exterior_price
 *   ceramic:         name, vehicle, bronze_price, silver_price, gold_price
 *   paint_correction: name, vehicle, one_step_price, two_step_price
 *   other:           name, vehicle
 */

import type { TemplateKey } from "./templates";

export type TemplateDefault = {
  template_key: TemplateKey;
  variant: string;
  name: string;
  subject: string;
  body_text: string;
};

// CTA without a URL — links in transactional emails were pushing them
// to Gmail's Promotions tab. Customers can simply reply to lock in.
const CTA = `Just reply to this email if you'd like to lock in a slot or have any other questions.`;

export const TEMPLATE_DEFAULTS: TemplateDefault[] = [
  {
    template_key: "inside_out",
    variant: "A",
    name: "Inside & Out — Default",
    subject: "Detailing estimate for your {{vehicle}}",
    body_text: `Hi {{name}},

Thanks for getting in touch about your {{vehicle}}. We've got two main inside-and-out packages depending on how deep you want to go.

Our Deluxe Detail is {{deluxe_price}} and runs about 3 to 4 hours. It covers a full exterior hand wash and dry, wheel faces, barrels and tyres, interior vacuum and plastics, door jambs, windows, and a 3-month paint sealant.

The Premium Detail is {{premium_price}} and takes 5 to 6 hours. It includes everything in the Deluxe plus a full interior shampoo (carpets, seats, mats), clay-bar paint decontamination, engine bay clean, and a 6-month sealant.

We can tweak either one to your budget. Shampoo seats only, skip the engine bay, whatever works.

If you're after long-term protection, ask me about paint correction (removes swirls and scratches) and our ceramic coatings (2 to 5+ years).

${CTA}

Cheers,
Max`,
  },
  {
    template_key: "interior_only",
    variant: "A",
    name: "Interior Only — Default",
    subject: "Interior detailing estimate for your {{vehicle}}",
    body_text: `Hi {{name}},

Thanks for getting in touch about an interior detail on your {{vehicle}}. Two main interior options:

Deluxe Interior is {{deluxe_interior_price}}, about 2.5 to 3 hours. Full vacuum, crevice detail, plastics cleaned and protected, door jambs and interior windows.

Premium Interior is {{premium_interior_price}}, about 3.5 to 4.5 hours. Everything in the Deluxe plus a full shampoo and extraction of seats, carpets and mats, double vacuum and stain extraction, plus an interior deodorising treatment.

Happy to flex on this. Seats only, leather protection coating, whatever you're after.

${CTA}

Cheers,
Max`,
  },
  {
    template_key: "exterior_only",
    variant: "A",
    name: "Exterior Only — Default",
    subject: "Exterior detailing estimate for your {{vehicle}}",
    body_text: `Hi {{name}},

Thanks for getting in touch about an exterior clean on your {{vehicle}}. Two options depending on what you're after:

Deluxe Exterior is {{deluxe_exterior_price}}, takes about 1.5 to 2 hours. Hand wash and dry, wheels, windows, and a 3-month wax sealant.

Premium Exterior is {{premium_exterior_price}}, around 2.5 to 3 hours. Everything in the Deluxe plus clay-bar treatment and full paint decontamination, for a smoother, glossier finish.

If your paint has visible swirls or scratches, ask me about paint correction and ceramic coating packages for longer-term protection.

${CTA}

Cheers,
Max`,
  },
  {
    template_key: "ceramic",
    variant: "A",
    name: "Ceramic Coating — Default",
    subject: "Ceramic coating estimate for your {{vehicle}}",
    body_text: `Hi {{name}},

Thanks for reaching out about ceramic coating for your {{vehicle}}. We're CarPro authorised installers and run three coating levels:

Bronze is {{bronze_price}} for 1-year protection. Gloss enhancement and strong hydrophobic performance.

Silver is {{silver_price}} for 3-year protection. Adds chemical resistance and an easy-clean surface.

Gold is {{gold_price}} for 5-year protection, backed by our company warranty. Maximum gloss retention, hardness improvement, top-tier hydrophobic performance.

All three include full surface prep (wash, decontamination, and spot polishing if needed).

${CTA}

Cheers,
Max`,
  },
  {
    template_key: "paint_correction",
    variant: "A",
    name: "Paint Correction — Default",
    subject: "Paint correction estimate for your {{vehicle}}",
    body_text: `Hi {{name}},

Thanks for reaching out about paint correction for your {{vehicle}}. It removes swirls, oxidation, and scratches, and brings a lot of depth and gloss back to the paint.

The 1-Step Correction is {{one_step_price}} and removes up to 90% of light swirls and micro-marring. Right for most daily drivers.

The 2-Step Correction is {{two_step_price}} and removes deeper scratches and watermarks, for the highest clarity and reflection.

Correction is the ideal prep step before a ceramic coating, so happy to bundle the two if you're interested.

${CTA}

Cheers,
Max`,
  },
  {
    template_key: "other",
    variant: "A",
    name: "Other / Fallback — Default",
    subject: "About your {{vehicle}}",
    body_text: `Hi {{name}},

Thanks for the enquiry about your {{vehicle}}. We do a few different services so just want to make sure we quote the right thing.

Most of our work is full inside-and-out details, interior-only or exterior-only details, paint correction (for swirls and scratches), and ceramic coating (for long-term protection). We don't do mechanical work, panel beating, window tinting, or standalone engine bay cleaning.

If you can tell me what you're after, I'll send pricing through today.

${CTA}

Cheers,
Max`,
  },
  {
    template_key: "lead_followup_3day",
    variant: "A",
    name: "Follow-up — 3 days after quote",
    subject: "Any questions about your {{vehicle}} estimate?",
    body_text: `Hi {{name}},

Just following up on the detailing estimate I sent through a few days ago for your {{vehicle}}.

Happy to answer any questions about the packages, help pick the right option, or tweak things to suit your budget. Most of our bookings go 1-2 weeks out so worth locking in a slot if you're keen.

Just reply to this email and I'll get you booked in.

Cheers,
Max`,
  },
  {
    template_key: "lead_followup_7day",
    variant: "A",
    name: "Follow-up — 7 days after quote (final)",
    subject: "Still keen on a detail for your {{vehicle}}?",
    body_text: `Hi {{name}},

Just one last check-in. Let me know if you're still keen for a detail on your {{vehicle}} — happy to help with timing, any questions, or adjusting the package to suit.

Otherwise no worries, I'll leave you be. Feel free to reach out anytime.

Cheers,
Max`,
  },
  {
    template_key: "lead_followup_30day",
    variant: "A",
    name: "Re-engagement — 30 days after quote",
    subject: "Still thinking about a detail for your {{vehicle}}?",
    body_text: `Hi {{name}},

Realised it's been about a month since I sent through your detailing estimate. Life gets busy — totally get it.

If a detail for your {{vehicle}} is still on the to-do list, just hit reply and I'll get you sorted. Happy to flex on timing or work to a different budget if helpful.

If not, no stress — won't follow up again from here.

Cheers,
Max`,
  },
];

/**
 * Variables available per template_key — used for the editor UI to show
 * the user which variables are safe to reference.
 */
export const TEMPLATE_VARIABLES: Record<TemplateKey, { key: string; label: string }[]> = {
  inside_out: [
    { key: "name", label: "Customer first name" },
    { key: "vehicle", label: "Vehicle (make + model)" },
    { key: "deluxe_price", label: "Deluxe Detail price (e.g. $370 + GST)" },
    { key: "premium_price", label: "Premium Detail price" },
  ],
  interior_only: [
    { key: "name", label: "Customer first name" },
    { key: "vehicle", label: "Vehicle (make + model)" },
    { key: "deluxe_interior_price", label: "Deluxe Interior Detail price" },
    { key: "premium_interior_price", label: "Premium Interior Detail price" },
  ],
  exterior_only: [
    { key: "name", label: "Customer first name" },
    { key: "vehicle", label: "Vehicle (make + model)" },
    { key: "deluxe_exterior_price", label: "Deluxe Exterior Detail price" },
    { key: "premium_exterior_price", label: "Premium Exterior Detail price" },
  ],
  ceramic: [
    { key: "name", label: "Customer first name" },
    { key: "vehicle", label: "Vehicle (make + model)" },
    { key: "bronze_price", label: "Ceramic Bronze (1 Year) price" },
    { key: "silver_price", label: "Ceramic Silver (2 Year) price" },
    { key: "gold_price", label: "Ceramic Gold (5 Year) price" },
  ],
  paint_correction: [
    { key: "name", label: "Customer first name" },
    { key: "vehicle", label: "Vehicle (make + model)" },
    { key: "one_step_price", label: "Paint Correction 1-Step price" },
    { key: "two_step_price", label: "Paint Correction 2-Step price" },
  ],
  other: [
    { key: "name", label: "Customer first name" },
    { key: "vehicle", label: "Vehicle (make + model)" },
  ],
  lead_followup_3day: [
    { key: "name", label: "Customer first name" },
    { key: "vehicle", label: "Vehicle (make + model)" },
  ],
  lead_followup_7day: [
    { key: "name", label: "Customer first name" },
    { key: "vehicle", label: "Vehicle (make + model)" },
  ],
  lead_followup_30day: [
    { key: "name", label: "Customer first name" },
    { key: "vehicle", label: "Vehicle (make + model)" },
  ],
};

export const TEMPLATE_KEY_LABELS: Record<TemplateKey, string> = {
  inside_out: "Inside & Out (Full Detail)",
  interior_only: "Interior Only",
  exterior_only: "Exterior Only",
  ceramic: "Ceramic Coating",
  paint_correction: "Paint Correction",
  other: "Other / Fallback",
  lead_followup_3day: "Follow-up: 3 days after quote",
  lead_followup_7day: "Follow-up: 7 days after quote",
  lead_followup_30day: "Re-engagement: 30 days after quote",
};
