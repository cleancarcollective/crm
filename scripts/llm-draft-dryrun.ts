/**
 * Dry-run the LLM drafter against the most recent N pending-approval leads
 * across all shops. Doesn't write to the DB or send email — just prints
 * what the LLM would have drafted, so you can sanity-check the calibration
 * before the path goes live.
 *
 * Usage: npx tsx scripts/llm-draft-dryrun.ts [count]
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

import { llmDraftQuote, type LlmDraftInput } from "@/lib/autorespond/llmDraftQuote";
import { buildTemplateContext, loadAndRenderTemplate } from "@/lib/autorespond/templateRenderer";
import { pickTemplateKey, templateNeedsSize } from "@/lib/autorespond/templates";
import { classifyVehicle } from "@/lib/autorespond/vehicleSizing";
import type { VehicleSize } from "@/lib/autorespond/vehicleSizing";
import { getShopContactsById } from "@/lib/email/shopContacts";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

async function main() {
  const N = Number(process.argv[2] ?? 5);
  const supabase = getSupabaseAdminClient();
  const { data: leads } = await supabase
    .from("leads")
    .select(`
      id, shop_id, service_requested, notes, reason_code,
      contact:contacts(first_name),
      vehicle:vehicles(year, make, model),
      shop:shops(name, slug)
    `)
    .eq("status", "needs_approval")
    .order("created_at", { ascending: false })
    .limit(N);

  if (!leads || leads.length === 0) {
    console.log("No needs_approval leads.");
    return;
  }

  for (const l of leads as any[]) {
    const c = l.contact ?? {};
    const v = l.vehicle ?? {};
    const shop = l.shop ?? {};
    const contacts = await getShopContactsById(l.shop_id);

    const reason: LlmDraftInput["reason"] = "notes_present";

    // Render the actual deterministic template so we can show the injection
    // in context. Mirrors what processLead does live.
    const templateKey = pickTemplateKey(l.service_requested ?? "");
    const needsSize = templateNeedsSize(templateKey);
    let suggestedSize: VehicleSize | null = null;
    if (v.make && v.model) {
      const cls = classifyVehicle(v.make, v.model);
      suggestedSize = cls?.size ?? null;
    }
    const supabase2 = getSupabaseAdminClient();
    const { data: pricingRows } = await supabase2
      .from("pricing")
      .select("service_name, size, price_ex_gst")
      .eq("shop_id", l.shop_id);
    const pricing = new Map<string, number>();
    for (const r of (pricingRows ?? []) as Array<{ service_name: string; size: string | null; price_ex_gst: number | null }>) {
      const key = r.size ? `${r.service_name}|${r.size}` : r.service_name;
      pricing.set(key, r.price_ex_gst ?? 0);
    }
    const ctx = buildTemplateContext(
      templateKey,
      c.first_name ?? "there",
      v.make ?? "",
      v.model ?? "",
      needsSize ? suggestedSize : null,
      pricing
    );
    let deterministicSubject = "";
    let deterministicBody = "";
    try {
      const rendered = await loadAndRenderTemplate(l.shop_id, templateKey, ctx);
      deterministicSubject = rendered.subject;
      deterministicBody = rendered.textBody;
    } catch (e) {
      console.warn(`  Could not render template (${(e as Error).message}) — passing empty.`);
    }

    const input: LlmDraftInput = {
      shopId: l.shop_id,
      shopName: shop.name ?? "Clean Car Collective",
      shopSlug: shop.slug ?? "",
      senderFirstName: contacts.sender_name,
      bookingUrl: `${contacts.website}/make-a-booking`,
      reason,
      firstName: c.first_name ?? "there",
      serviceRequested: l.service_requested,
      vehicleMake: v.make ?? null,
      vehicleModel: v.model ?? null,
      vehicleYear: v.year ?? null,
      customerNotes: l.notes,
      deterministicSubject,
      deterministicBody,
    };

    console.log("\n" + "=".repeat(80));
    console.log(`Lead ${l.id.slice(0, 8)}  shop=${shop.slug}  ${[v.year, v.make, v.model].filter(Boolean).join(" ") || "(no vehicle)"} — ${l.service_requested ?? "(no service)"}`);
    console.log("=".repeat(80));
    if (l.notes) console.log("Customer notes:", l.notes);

    try {
      const result = await llmDraftQuote(input);
      console.log(`\n→ Confidence: ${(result.confidence * 100).toFixed(0)}%`);
      if (result.noteResponse) {
        console.log(`  Injected paragraph: "${result.noteResponse}"`);
      } else {
        console.log(`  (No paragraph injected — no notes or LLM declined.)`);
      }
      if (result.needsMoreInfo) console.log(`  ⚠ Needs more info: ${result.needsMoreInfo}`);
      console.log(`  Internal: ${result.internalNotes}`);
      console.log(`  Tokens: prompt=${result.usage.promptTokens ?? 0}, completion=${result.usage.completionTokens ?? 0}`);
      console.log("\n--- FINAL DRAFT ---");
      console.log("Subject:", result.subject);
      console.log("");
      console.log(result.body);
    } catch (err) {
      console.error("LLM draft error:", err instanceof Error ? err.message : err);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
