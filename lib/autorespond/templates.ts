/**
 * Email template generation for auto-respond estimates.
 * Ported from Google Apps Script CCC Estimate Automation.
 */

import type { VehicleSize } from "./vehicleSizing";

export type TemplateKey =
  | "inside_out"
  | "interior_only"
  | "exterior_only"
  | "ceramic"
  | "paint_correction"
  | "other";

export type EstimateDraft = {
  subject: string;
  textBody: string;
  htmlBody: string;
  templateKey: TemplateKey;
};

export type PricingMap = Map<string, number>; // "ServiceName|Size" -> price_ex_gst

const BOOKING_URL = "https://cleancarcollective.co.nz/make-a-booking/";

// ── Helpers ────────────────────────────────────────────────────────────────

function titleCase(str: string): string {
  return (str || "")
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function vehicleDisplay(makeRaw: string, modelRaw: string): string {
  let model = (modelRaw || "").toLowerCase();
  model = model.replace(/\b(19|20)\d{2}\b/g, "");
  model = model.replace(/\b(white|black|silver|grey|gray|blue|red|green|gold|beige)\b/g, "");
  model = model.replace(/\b(hatch|hatchback|wagon|estate|sedan|saloon|coupe|convertible|ute|van|station)\b/g, "");
  model = model.replace(/\b(auto|automatic|manual|petrol|diesel|hybrid|awd|fwd|rwd)\b/g, "");
  model = titleCase(model.replace(/\s+/g, " ").trim());
  const make = titleCase(makeRaw || "");
  return [make, model].filter(Boolean).join(" ").trim() || "your vehicle";
}

function htmlBody(plain: string): string {
  let html = plain
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

  const escapedUrl = BOOKING_URL.replace(/&/g, "&amp;");
  html = html.replace(
    escapedUrl,
    `<a href="${BOOKING_URL}" style="color:#1a73e8;text-decoration:underline;">make a booking here</a>`
  );
  html = html.replace(
    /If you&#39;d like to make a booking, you can do so here: <a /,
    "If you&#39;d like to make a booking, you can <a "
  );

  return `<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.6;white-space:pre-wrap;">${html}</div>`;
}

function getPrice(pricing: PricingMap, serviceName: string, size: string): number {
  const key = `${serviceName}|${size}`;
  const price = pricing.get(key);
  if (price === undefined) {
    throw new Error(`Missing pricing for: ${serviceName} / ${size}`);
  }
  return price;
}

const CTA = `If you'd like to make a booking, you can do so here: ${BOOKING_URL}`;

// ── Template picker ────────────────────────────────────────────────────────

export function pickTemplateKey(servicesRaw: string): TemplateKey {
  const s = (servicesRaw || "").toLowerCase().trim();
  if (s.includes("inside") && s.includes("out")) return "inside_out";
  if (s === "inside and out package options") return "inside_out";
  if (s === "interior only" || s === "interior") return "interior_only";
  if (s === "exterior only" || s === "exterior") return "exterior_only";
  if (s.includes("ceramic")) return "ceramic";
  if (s.includes("paint correction")) return "paint_correction";
  return "other";
}

export function templateNeedsSize(key: TemplateKey): boolean {
  return key === "inside_out" || key === "interior_only" || key === "exterior_only";
}

// ── Template builders ──────────────────────────────────────────────────────

export function buildEstimateDraft(
  templateKey: TemplateKey,
  firstName: string,
  makeRaw: string,
  modelRaw: string,
  size: VehicleSize | null,
  pricing: PricingMap
): EstimateDraft {
  const name = titleCase(firstName) || "there";
  const vehicle = vehicleDisplay(makeRaw, modelRaw);
  const sizeKey = size ?? "Any";

  if (templateKey === "inside_out") {
    const deluxePrice = getPrice(pricing, "Deluxe Detail", sizeKey);
    const premiumPrice = getPrice(pricing, "Premium Detail", sizeKey);

    const text = `Hi ${name},

Thanks for reaching out for a detailing estimate for your ${vehicle}.
We offer two main interior & exterior packages designed to suit different levels of cleaning and restoration:

Deluxe Detail -- $${deluxePrice} + GST (approx. 3.5-4 hours)
- Exterior hand wash & dry
- Wheel faces, barrels & tires cleaned
- Interior vacuum and plastics detailed
- Door jamb & window cleaning
- 3-month paint sealant applied for protection

Premium Detail -- $${premiumPrice} + GST (approx. 5.5-6.5 hours)
- Includes everything in the Deluxe Detail, plus:
- Full interior shampoo (carpets, seats, mats)
- Clay bar treatment for paint decontamination
- Engine bay cleaning
- 6-month paint sealant applied

We can also tailor the package, for example, by just shampooing the seats or skipping the engine bay.

If you're looking for the ultimate result, we also offer paint correction (removes light swirls & scratches) and ceramic coatings (2-5+ year protection). Happy to include pricing for those if you're interested.

Please let me know if you have any questions, or if you'd like to go ahead.
${CTA}

Cheers,
Max`;

    return { subject: `Detailing estimate for your ${vehicle}`, textBody: text, htmlBody: htmlBody(text), templateKey };
  }

  if (templateKey === "interior_only") {
    const deluxePrice = getPrice(pricing, "Deluxe Interior Detail", sizeKey);
    const premiumPrice = getPrice(pricing, "Premium Interior Detail", sizeKey);

    const text = `Hi ${name},

Thanks for your inquiry about an interior detail for your ${vehicle}.
Here are our two main interior packages:

Deluxe Interior -- $${deluxePrice} + GST (approx. 2.5-3 hours)
- Full interior vacuum (carpets, mats, seats)
- Crevice detail for all surfaces
- Interior plastics cleaned & protected
- Door jambs & interior windows cleaned

Premium Interior -- $${premiumPrice} + GST (approx. 3.5-4.5 hours)
- Includes everything in the Deluxe Interior, plus:
- Shampoo & extraction of all seats, carpets, and mats
- Double vacuum & stain extraction
- Interior deodorising treatment

We can also customise the job, for example, if you only want the seats shampooed, we can adjust pricing accordingly.
If you're interested in long-term protection, we can add interior fabric/leather protection coatings to keep surfaces cleaner for longer.

Please let me know if you have any questions, or if you'd like to go ahead.
${CTA}

Cheers,
Max`;

    return { subject: `Interior detailing estimate for your ${vehicle}`, textBody: text, htmlBody: htmlBody(text), templateKey };
  }

  if (templateKey === "exterior_only") {
    const deluxePrice = getPrice(pricing, "Deluxe Exterior Detail", sizeKey);
    const premiumPrice = getPrice(pricing, "Premium Exterior Detail", sizeKey);

    const text = `Hi ${name},

Thanks for getting in touch about an exterior clean for your ${vehicle}.
We offer two main exterior hand wash services:

Deluxe Exterior -- $${deluxePrice} + GST (approx. 1.5-2 hours)
- Exterior hand wash & dry
- Wheel faces, barrels & tires cleaned
- Windows & mirrors cleaned
- Wax/paint sealant applied for 3 months of protection

Premium Exterior -- $${premiumPrice} + GST (approx. 2.5-3 hours)
- Includes everything in Deluxe, plus:
- Clay bar treatment to remove bonded contaminants
- Full paint decontamination for a smoother, glossier finish

If your paint has visible swirls or scratches, we also offer paint correction and ceramic coating packages for longer-term protection -- happy to provide details if you'd like.

Please let me know if you have any questions, or if you'd like to go ahead.
${CTA}

Cheers,
Max`;

    return { subject: `Exterior detailing estimate for your ${vehicle}`, textBody: text, htmlBody: htmlBody(text), templateKey };
  }

  if (templateKey === "ceramic") {
    const bronze = getPrice(pricing, "Ceramic Bronze (1 Year)", "Any");
    const silver = getPrice(pricing, "Ceramic Silver (2 Year)", "Any");
    const gold = getPrice(pricing, "Ceramic Gold (5 Year)", "Any");

    const text = `Hi ${name},

Thanks for reaching out about ceramic coating protection for your ${vehicle}.

We are CarPro authorized installers and offer three levels of coating to suit different vehicles and budgets:

Bronze Package -- $${bronze} + GST
- 1-year protection
- Gloss enhancement & strong hydrophobic properties

Silver Package -- $${silver} + GST
- 3-year protection
- Added chemical resistance & easy-clean surface

Gold Package -- $${gold} + GST
- 5-year protection (backed by our company warranty)
- Maximum gloss retention, hardness improvement & top-tier hydrophobic performance

All coatings include a full surface prep (wash, decontamination, and spot polishing if needed).

Please let me know if you have any questions, or if you'd like to go ahead.
${CTA}

Cheers,
Max`;

    return { subject: `Ceramic coating estimate for your ${vehicle}`, textBody: text, htmlBody: htmlBody(text), templateKey };
  }

  if (templateKey === "paint_correction") {
    const one = getPrice(pricing, "Paint Correction 1-Step", "Any");
    const two = getPrice(pricing, "Paint Correction 2-Step", "Any");

    const text = `Hi ${name},

Thanks for reaching out about paint correction for your ${vehicle}.

Paint correction removes light swirls, oxidation, and scratches, dramatically improving gloss and depth.

1-Step Correction -- $${one} + GST
- Removes up to 90% of light swirls & micro-marring
- Great for most daily drivers

2-Step Correction -- $${two} + GST
- Removes deeper scratches and watermarks
- Maximises clarity and reflection for high-end results

Correction is the perfect preparation step before applying a ceramic coating, ensuring a flawless, protected finish.

Please let me know if you have any questions, or if you'd like to go ahead.
${CTA}

Cheers,
Max`;

    return { subject: `Paint correction estimate for your ${vehicle}`, textBody: text, htmlBody: htmlBody(text), templateKey };
  }

  // other / fallback
  const text = `Hi ${name},

Thanks for reaching out about your ${vehicle}.
We've received your request and will come back to you shortly with the right options and pricing.

${CTA}

Cheers,
Max`;

  return { subject: `Estimate request received for your ${vehicle}`, textBody: text, htmlBody: htmlBody(text), templateKey };
}
