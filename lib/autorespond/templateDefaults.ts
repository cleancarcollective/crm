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

Thanks for getting in touch about a detail on your {{vehicle}}. We've got two main inside-and-out packages:

Deluxe Detail — {{deluxe_price}} (approx. 3.5-4 hours)
- Exterior hand wash & dry
- Wheel faces, barrels & tyres cleaned
- Interior vacuum & plastics detailed
- Door jambs & windows cleaned
- 3-month paint sealant

Premium Detail — {{premium_price}} (approx. 5.5-6.5 hours)
- Everything in the Deluxe, plus:
- Full interior shampoo (carpets, seats, mats)
- Clay-bar paint decontamination
- Engine bay cleaning
- 6-month paint sealant

We can tailor either one. Just shampoo the seats, skip the engine bay, whatever works.

If you're after long-term protection, ask about paint correction (swirl/scratch removal) and ceramic coatings (2-5+ years).

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

Thanks for getting in touch about an interior detail on your {{vehicle}}. Two main options:

Deluxe Interior — {{deluxe_interior_price}} (approx. 2.5-3 hours)
- Full interior vacuum (carpets, mats, seats)
- Crevice detail
- Plastics cleaned & protected
- Door jambs & interior windows

Premium Interior — {{premium_interior_price}} (approx. 3.5-4.5 hours)
- Everything in the Deluxe, plus:
- Full shampoo & extraction of seats, carpets & mats
- Double vacuum & stain extraction
- Interior deodorising treatment

Happy to customise too. Seats only, leather protection coating, whatever you need.

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

Deluxe Exterior — {{deluxe_exterior_price}} (approx. 1.5-2 hours)
- Hand wash & dry
- Wheel faces, barrels & tyres cleaned
- Windows & mirrors
- 3-month wax/paint sealant

Premium Exterior — {{premium_exterior_price}} (approx. 2.5-3 hours)
- Everything in the Deluxe, plus:
- Clay-bar treatment to remove bonded contaminants
- Full paint decontamination for a smoother, glossier finish

If your paint has visible swirls or scratches, ask about paint correction and ceramic coating packages for longer-term protection.

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

Bronze — {{bronze_price}}
- 1-year protection
- Gloss enhancement & strong hydrophobic properties

Silver — {{silver_price}}
- 3-year protection
- Added chemical resistance & easy-clean surface

Gold — {{gold_price}}
- 5-year protection (backed by our company warranty)
- Maximum gloss retention, hardness improvement & top-tier hydrophobic performance

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

1-Step Correction — {{one_step_price}}
- Removes up to 90% of light swirls & micro-marring
- Great for most daily drivers

2-Step Correction — {{two_step_price}}
- Removes deeper scratches and watermarks
- Maximum clarity and reflection for high-end results

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
