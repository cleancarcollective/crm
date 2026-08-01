/**
 * GET /api/cron/warm-availability
 *
 * Keeps the per-shop availability Apps Scripts warm.
 *
 * Google Apps Script deployments go cold after a few minutes idle and pay
 * a ~30s cold-start on the next hit. Christchurch is low-volume, so its
 * script was cold most of the time — the first customer to reach the
 * Schedule step waited 30s+ on "Finding slots" (1 Aug 2026 incident).
 * Wellington stays warm on its own from booking traffic.
 *
 * This pings the availability endpoint for every active shop on a short
 * schedule so the scripts stay warm through the NZ booking day. It's a
 * plain self-fetch of the public endpoint (which fans out to Apps Script),
 * so it exercises the exact path a customer would hit.
 *
 * Auth: same dual-mode as other crons.
 */

import { NextResponse } from "next/server";

function isAuthorized(request: Request) {
  const vercelCron = request.headers.get("x-vercel-cron");
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (vercelCron === "1") return true;
  if (!cronSecret) throw new Error("Missing required environment variable: CRON_SECRET");
  return authHeader === `Bearer ${cronSecret}`;
}

const SHOPS = ["christchurch", "wellington"] as const;
const TYPES = ["shop", "mobile"] as const;

const BASE_URL = process.env.CRM_BASE_URL ?? "https://crm.cleancarcollective.co.nz";

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // NZ-local today, so the warmed window matches what customers request.
  const start = new Date().toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" });

  const results = await Promise.allSettled(
    SHOPS.flatMap((shop) =>
      TYPES.map(async (type) => {
        const url = `${BASE_URL}/api/public/availability?shop=${shop}&type=${type}&days=14&start=${start}`;
        const t0 = Date.now();
        const res = await fetch(url, { cache: "no-store" });
        return { shop, type, status: res.status, ms: Date.now() - t0 };
      })
    )
  );

  const warmed = results.map((r) =>
    r.status === "fulfilled" ? r.value : { error: String(r.reason) }
  );

  return NextResponse.json({ ok: true, warmed });
}
