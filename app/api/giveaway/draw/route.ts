/**
 * POST /api/giveaway/draw   (admin, session-authenticated)
 *
 * Weighted random draw: 1 grand prize, 10 runners-up, 3 reserves, from all
 * valid (non-test) entries. Each entry holds 1 ticket plus 1 per friend who
 * entered through its share link (capped in REFERRAL.maxExtraEntries). If
 * the grand prize winner came in through a link, the referrer also wins a
 * grand prize and is taken out of the pool, so nobody wins twice.
 *
 * Stores the prize (and the ticket count at draw time) on each winning
 * lead's internal_notes entry tag and stamps a draw_id so re-running is
 * explicit (pass { redraw: true }). Only rows whose tag changes are
 * written, so a draw over thousands of entries stays inside the function
 * time limit.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentShop";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { GIVEAWAY, parseEntryTag, replaceEntryTag, referralCounts, ticketsFor, runDraw, type EntryTag } from "@/lib/giveaway/wlgOct2026";

const RUNNERS_UP = 10;
const RESERVES = 3;
const PRIZE_GRAND = "GRAND PRIZE - Premium Protection Pack + $100";
const PRIZE_GRAND_BONUS = "GRAND PRIZE (referral bonus) - Premium Protection Pack + $100";
const PRIZE_RUNNER_UP = "Second prize - $250 off the Protection Pack";

type Contact = { full_name?: string | null; first_name?: string | null; last_name?: string | null; email?: string | null; phone?: string | null };
type Vehicle = { year?: string | null; make?: string | null; model?: string | null };
const nameOf = (c: Contact | null | undefined) => c?.full_name || [c?.first_name, c?.last_name].filter(Boolean).join(" ");

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Admins only." }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { redraw?: boolean };
  const supabase = getSupabaseAdminClient();

  const { data: entries } = await supabase
    .from("leads")
    .select("id, created_at, internal_notes, contacts(full_name, first_name, last_name, email, phone), vehicles(year, make, model)")
    .eq("shop_id", user.shop.id)
    .eq("source", GIVEAWAY.leadSource)
    .ilike("internal_notes", `%[giveaway:${GIVEAWAY.key}]%`)
    .limit(5000);

  const valid = (entries ?? [])
    .map((e) => ({ ...e, tag: parseEntryTag(e.internal_notes) as EntryTag }))
    .filter((e) => e.tag && !e.tag.test);
  if (valid.length === 0) return NextResponse.json({ error: "No entries to draw from yet." }, { status: 400 });

  const alreadyDrawn = valid.some((e) => e.tag.prize);
  if (alreadyDrawn && !body.redraw) {
    return NextResponse.json({ error: "A draw already exists. Pass redraw:true to replace it." }, { status: 409 });
  }

  const counts = referralCounts(valid);
  const tickets = valid.map((e) => ticketsFor(e.tag, counts));
  const indexByCode = new Map<string, number>();
  valid.forEach((e, i) => { if (e.tag.code) indexByCode.set(e.tag.code, i); });
  const referrerOf = (i: number) => {
    const r = valid[i].tag.ref;
    if (!r) return null;
    const j = indexByCode.get(r);
    return j === undefined ? null : j;
  };

  const outcome = runDraw({ tickets, referrerOf, runnersUp: RUNNERS_UP, reserves: RESERVES });
  if (!outcome) return NextResponse.json({ error: "No entries to draw from yet." }, { status: 400 });

  const prizeOf = new Map<number, string>();
  prizeOf.set(outcome.grand, PRIZE_GRAND);
  if (outcome.bonus !== null) prizeOf.set(outcome.bonus, PRIZE_GRAND_BONUS);
  outcome.runnersUp.forEach((i) => prizeOf.set(i, PRIZE_RUNNER_UP));
  outcome.reserves.forEach((i, k) => prizeOf.set(i, `Reserve #${k + 1}`));

  const drawId = new Date().toISOString();
  const updates: Array<{ id: string; internal_notes: string }> = [];
  valid.forEach((e, i) => {
    const prize = prizeOf.get(i);
    if (!prize && !e.tag.prize) return; // untouched by this draw and no stale prize to clear
    const next: EntryTag = { ...e.tag, tickets: tickets[i] };
    if (prize) { next.prize = prize; next.draw_id = drawId; }
    else { delete next.prize; delete next.draw_id; }
    updates.push({ id: e.id, internal_notes: replaceEntryTag(e.internal_notes, next) });
  });
  for (let k = 0; k < updates.length; k += 10) {
    await Promise.all(updates.slice(k, k + 10).map((u) => supabase.from("leads").update({ internal_notes: u.internal_notes }).eq("id", u.id)));
  }

  const order = [outcome.grand, ...(outcome.bonus !== null ? [outcome.bonus] : []), ...outcome.runnersUp, ...outcome.reserves];
  const winners = order.map((i) => {
    const e = valid[i];
    const c = (e.contacts ?? null) as Contact | null;
    const v = (e.vehicles ?? null) as Vehicle | null;
    const r = referrerOf(i);
    return {
      prize: prizeOf.get(i),
      name: nameOf(c),
      email: c?.email ?? null,
      phone: c?.phone ?? null,
      vehicle: [v?.year, v?.make, v?.model].filter(Boolean).join(" "),
      tickets: tickets[i],
      referred_by: r === null ? null : nameOf((valid[r].contacts ?? null) as Contact | null),
    };
  });

  return NextResponse.json({
    ok: true,
    drawn_from: valid.length,
    tickets_total: tickets.reduce((a, b) => a + b, 0),
    draw_id: drawId,
    winners,
  });
}
