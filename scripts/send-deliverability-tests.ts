/**
 * Fire the real estimate template via Postmark to a list of test addresses.
 * Used to check Gmail / Outlook inbox placement and overall deliverability
 * without involving a real customer.
 *
 * Renders the same Inside & Out template a real lead would see — same
 * subject, same body, same per-shop sender. Wellington is hardcoded since
 * that's where the booking-drop concern is.
 *
 * No DB writes: doesn't insert email_messages or update any lead. Pure
 * Postmark send + return.
 */

import fs from "node:fs";
import path from "node:path";

function loadEnv(file: string) {
  const envPath = path.join(process.cwd(), file);
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnv(".env.local");
loadEnv(".env.vercel.local");

import { TEMPLATE_DEFAULTS } from "@/lib/autorespond/templateDefaults";
import { buildTemplateContext } from "@/lib/autorespond/templateRenderer";
import type { VehicleSize } from "@/lib/autorespond/vehicleSizing";
import { sendViaGmailSmtp } from "@/lib/email/smtpClient";
import { getShopContactsById } from "@/lib/email/shopContacts";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

const TEST_RECIPIENTS = [
  "tebbs.max@gmail.com",
  "joetrebble1@gmail.com",
];

function substitute(template: string, ctx: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) =>
    Object.prototype.hasOwnProperty.call(ctx, k) ? ctx[k] : `{{${k}}}`
  );
}

async function main() {
  const supabase = getSupabaseAdminClient();
  const { data: shop } = await supabase.from("shops").select("id, slug, name, timezone").eq("slug", "wellington").single();
  if (!shop) throw new Error("no wellington shop");

  const contacts = await getShopContactsById(shop.id);

  // Pricing for inside_out template
  const { data: pricingRows } = await supabase
    .from("pricing")
    .select("service_name, size, price_ex_gst")
    .eq("shop_id", shop.id);
  const pricing = new Map<string, number>();
  for (const r of (pricingRows ?? []) as Array<{ service_name: string; size: string | null; price_ex_gst: number | null }>) {
    const key = r.size ? `${r.service_name}|${r.size}` : r.service_name;
    pricing.set(key, r.price_ex_gst ?? 0);
  }

  // Render inside_out, medium-sized Toyota Camry as a representative case
  const template = TEMPLATE_DEFAULTS.find((t) => t.template_key === "inside_out")!;
  const ctx = buildTemplateContext(
    "inside_out",
    "there", // generic salutation — substitute per-recipient below
    "Toyota",
    "Camry",
    "medium" as VehicleSize,
    pricing
  );

  const sentAt = new Date().toISOString();

  for (const recipient of TEST_RECIPIENTS) {
    const name = recipient.split("@")[0]!.split(/[._-]/)[0]!;
    const personalCtx = { ...ctx, name: name.charAt(0).toUpperCase() + name.slice(1) };
    const subject = `[TEST ${sentAt.slice(11, 16)}] ` + substitute(template.subject, personalCtx);
    const textBody = substitute(template.body_text, personalCtx);
    // Send via the same path real customer estimates use now (Gmail SMTP).
    const result = await sendViaGmailSmtp({
      From: contacts.from_line,
      To: recipient,
      ReplyTo: contacts.reply_email,
      Subject: subject,
      TextBody: textBody,
      Metadata: {
        shop_id: shop.id,
        template_key: "inside_out",
        test: "deliverability_audit",
      },
    });
    console.log(`✓ sent to ${recipient}  message-id=${result.MessageID}`);
  }

  console.log("");
  console.log("Now: check both inboxes. Note which folder it lands in (Primary / Promotions / Spam / not delivered).");
  console.log("Also consider forwarding to https://www.mail-tester.com for a deliverability score.");
}

main().catch((e) => { console.error(e); process.exit(1); });
