/**
 * Send the 3 ad-nurture touchpoints to a preview inbox, rendered exactly as
 * a real Wellington ad lead would receive them (sample RAV4 payload with
 * discounted prices). Sends via the same Gmail SMTP path as production.
 *
 * Usage: npx tsx scripts/preview-ad-nurture-send.ts <email>
 */

import fs from "node:fs";
import path from "node:path";
function loadEnv(f: string) {
  const p = path.join(process.cwd(), f);
  if (!fs.existsSync(p)) return;
  for (const l of fs.readFileSync(p, "utf-8").split("\n")) {
    const t = l.trim();
    if (!t || t.startsWith("#")) continue;
    const e = t.indexOf("=");
    if (e === -1) continue;
    const k = t.slice(0, e).trim();
    let v = t.slice(e + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv(".env.local");
loadEnv(".env.vercel.local");

import { renderAdNurtureEmail, AD_NURTURE_JOB_TYPES, type AdNurturePayload } from "@/lib/autorespond/adNurture";
import { sendViaGmailSmtp } from "@/lib/email/smtpClient";

const TO = process.argv[2];
if (!TO || !TO.includes("@")) {
  console.error("Usage: npx tsx scripts/preview-ad-nurture-send.ts <email>");
  process.exit(1);
}

const payload: AdNurturePayload = {
  shopId: "preview",
  leadId: "preview",
  contactId: null,
  email: TO,
  firstName: "Max",
  vehicleLabel: "2019 Toyota RAV4",
  promoCode: "CCC10",
  promoPercentOff: 10,
  packages: [
    { name: "Deluxe Detail", priceLabel: "$351 + GST", originalPriceLabel: "$390 + GST" },
    { name: "Premium Detail", priceLabel: "$585 + GST", originalPriceLabel: "$650 + GST" },
  ],
  bookingVehicleType: "Small / Medium SUV",
  quotedAt: new Date().toISOString(),
};

async function main() {
  for (const jobType of AD_NURTURE_JOB_TYPES) {
    const r = renderAdNurtureEmail(jobType, payload, "wellington", "Max");
    const res = await sendViaGmailSmtp({
      From: "Max <hello@cleancarcollective.co.nz>",
      To: TO,
      Subject: r.subject,
      TextBody: r.textBody,
      HtmlBody: r.htmlBody,
      Metadata: { preview: "ad-nurture", touch: jobType },
    });
    console.log(jobType, "->", JSON.stringify(res).slice(0, 120));
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
