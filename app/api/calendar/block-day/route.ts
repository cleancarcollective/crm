/**
 * POST /api/calendar/block-day
 *
 * Lets any signed-in staff member block a day (or a time range within a
 * day) on the shop's Google Calendar. Writes events directly to the
 * Google Calendar API via a service account — no Apps Script middleware.
 *
 * The shop slug comes from the user's session (requireCurrentShop); a
 * single block fans out to BOTH the shop's "shop" and "mobile"
 * calendars so the day is unavailable for any booking type.
 *
 * Body:
 *   {
 *     day: "yyyy-MM-dd",
 *     scope: "all_day" | "time_range",
 *     start_time?: "HH:mm",     // required when scope=time_range
 *     end_time?: "HH:mm",       // required when scope=time_range
 *     reason?: string,          // optional, surfaced in event title
 *     action?: "block"          // only "block" is implemented today
 *   }
 *
 * Response mirrors the previous Apps Script-backed shape so the
 * existing BlockDayButton client code keeps working without changes.
 */

import { NextResponse } from "next/server";

import { requireCurrentShop } from "@/lib/auth/currentShop";
import {
  CALENDARS_BY_SHOP,
  type CalendarType,
  type ShopSlug,
  createCalendarEvent,
} from "@/lib/google/calendarAdmin";

type Body = {
  day?: string;
  scope?: "all_day" | "time_range";
  start_time?: string;
  end_time?: string;
  reason?: string | null;
  action?: "block" | "unblock";
};

const HHMM = /^\d{2}:\d{2}$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const BLOCK_TITLE_PREFIX = "Blocked via CRM";

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const action = body.action ?? "block";
  if (action !== "block") {
    // Unblock isn't implemented yet — would need to look up events by
    // title prefix + date and delete via Calendar API.
    return NextResponse.json({ ok: false, error: "Only action=block is supported" }, { status: 400 });
  }
  if (!body.day || !YMD.test(body.day)) {
    return NextResponse.json({ ok: false, error: "Invalid day (expect yyyy-MM-dd)" }, { status: 400 });
  }
  const scope = body.scope ?? "all_day";
  if (scope !== "all_day" && scope !== "time_range") {
    return NextResponse.json({ ok: false, error: "Invalid scope" }, { status: 400 });
  }
  if (scope === "time_range") {
    if (!body.start_time || !HHMM.test(body.start_time) || !body.end_time || !HHMM.test(body.end_time)) {
      return NextResponse.json({ ok: false, error: "Invalid start/end time" }, { status: 400 });
    }
    if (body.start_time >= body.end_time) {
      return NextResponse.json({ ok: false, error: "End time must be after start time" }, { status: 400 });
    }
  }

  const shop = await requireCurrentShop();
  const shopCalendars = CALENDARS_BY_SHOP[shop.slug as ShopSlug];
  if (!shopCalendars) {
    return NextResponse.json(
      { ok: false, error: `No calendar config for shop ${shop.slug}` },
      { status: 500 },
    );
  }

  const reason = body.reason?.trim();
  const title = BLOCK_TITLE_PREFIX + (reason ? ` — ${reason}` : "");

  // Fan out to both shop and mobile calendars in parallel — block
  // means the day is unavailable for either booking type.
  const types = Object.keys(shopCalendars) as CalendarType[];
  const results = await Promise.all(
    types.map(async (type) => {
      try {
        const event = await createCalendarEvent({
          calendarId: shopCalendars[type],
          title,
          scope,
          date: body.day!,
          startTime: body.start_time,
          endTime: body.end_time,
        });
        return { type, ok: true as const, event_id: event.id };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { type, ok: false as const, error: message };
      }
    }),
  );

  const anyOk = results.some((r) => r.ok);

  // Match the previous Apps Script-backed shape so the client UI doesn't
  // have to know we swapped the backend.
  return NextResponse.json({
    ok: anyOk,
    shop_slug: shop.slug,
    day: body.day,
    scope,
    action,
    upstream: { ok: anyOk, title, results },
  });
}
