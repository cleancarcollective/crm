import { NextResponse } from "next/server";

import { classifyVehicle, type VehicleSize } from "@/lib/autorespond/vehicleSizing";
import { lookupVehicleSizeFromCache } from "@/lib/autorespond/vehicleSizeCache";
import { classifyVehicleViaLlm } from "@/lib/autorespond/llmVehicleSize";

/**
 * Public vehicle-sizing endpoint. Given make/model/year it returns the size
 * class (Small/Medium/Large/XL) plus the booking-app vehicle-type label, so
 * the ceramic ad funnel can auto-price by size instead of making the
 * customer guess their "size class". Reuses the exact estimate-flow
 * pipeline: MODEL_DB → cache → LLM fallback.
 *
 * Called cross-origin from the booking apps, so CORS is open. Read-only
 * except for the cache write-back inside classifyVehicleViaLlm.
 */

export const maxDuration = 30;

// Mirrors SIZE_TO_BOOKING_VEHICLE in the CRM lead intake so the funnel
// price matches the estimate quote for the same car.
const SIZE_TO_BOOKING_VEHICLE: Record<VehicleSize, string> = {
  Small: "Coupe / Hatchback",
  Medium: "Sedan / Wagon",
  Large: "Small / Medium SUV",
  XL: "Large SUV / Ute",
};

function withCors(res: NextResponse) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return res;
}

export function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

async function resolve(make: string, model: string, year: string | null) {
  // 1. Deterministic model DB (exact + fuzzy)
  const det = classifyVehicle(make, model);
  if (det && det.confidence !== "low") {
    return { size: det.size, confidence: det.confNumeric, source: det.reasonCode };
  }
  // 2. Cache (previously LLM-resolved or staff-overridden). Year-aware:
  //    a request far from the cached year re-checks via the LLM.
  const cached = await lookupVehicleSizeFromCache(make, model, year);
  if (cached && cached.confidence >= 0.6) {
    return { size: cached.size, confidence: cached.confidence, source: `cache_${cached.source}` };
  }
  // 3. LLM fallback (writes back to cache on success)
  const llm = await classifyVehicleViaLlm(make, model, year);
  if (llm && llm.confidence >= 0.6) {
    return { size: llm.size, confidence: llm.confidence, source: "llm" };
  }
  // 4. Low-confidence deterministic guess if we had one, else null
  if (det) return { size: det.size, confidence: det.confNumeric, source: `${det.reasonCode}_low` };
  return null;
}

async function handle(make: string, model: string, year: string | null) {
  if (!make.trim() || !model.trim()) {
    return withCors(NextResponse.json({ ok: false, error: "make and model required" }, { status: 400 }));
  }
  try {
    const r = await resolve(make.trim(), model.trim(), year?.trim() || null);
    if (!r) {
      return withCors(NextResponse.json({ ok: true, resolved: false }));
    }
    return withCors(NextResponse.json({
      ok: true,
      resolved: true,
      size: r.size,
      confidence: r.confidence,
      source: r.source,
      booking_vehicle_type: SIZE_TO_BOOKING_VEHICLE[r.size],
    }));
  } catch (err) {
    console.error("vehicle-size resolve failed", err);
    return withCors(NextResponse.json({ ok: false, error: "internal error" }, { status: 500 }));
  }
}

export async function GET(request: Request) {
  const u = new URL(request.url);
  return handle(u.searchParams.get("make") || "", u.searchParams.get("model") || "", u.searchParams.get("year"));
}

export async function POST(request: Request) {
  let body: { make?: string; model?: string; year?: string } = {};
  try { body = await request.json(); } catch { /* empty */ }
  return handle(body.make || "", body.model || "", body.year || null);
}
