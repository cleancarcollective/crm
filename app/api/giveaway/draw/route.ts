/**
 * POST /api/giveaway/draw   (admin, session-authenticated)
 *
 * Random draw: 1 grand prize, 10 runners-up, 3 reserves, from all valid
 * (non-test) entries. Ported from the Apps Script "Draw winners" menu.
 * Stores the prize on each winning lead's internal_notes entry tag and
 * stamps a draw_id so re-running is explicit (pass { redraw: true }).
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentShop";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { GIVEAWAY, parseEntryTag, replaceEntryTag } from "@/lib/giveaway/wlgOct2026";

const RUNNERS_UP = 10;
const RESERVES = 3;

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

  const withTag = (entries ?? []).map((e) => ({ ...e, tag: parseEntryTag(e.internal_notes) })).filter((e) => e.tag);
  const valid = withTag.filter((e) => !e.tag!.test);
  if (valid.length === 0) return NextResponse.json({ error: "No entries to draw from yet." }, { status: 400 });

  const alreadyDrawn = valid.some((e) => e.tag!.prize);
  if (alreadyDrawn && !body.redraw) {
    return NextResponse.json({ error: "A draw already exists. Pass redraw:true to replace it." }, { status: 409 });
  }

  // Fisher-Yates
  const rows = [...valid];
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }

  const drawId = new Date().toISOString();
  const winners: Array<{ prize: string; name: string; email: string | null; phone: string | null; vehicle: string }> = [];
  for (let idx = 0; idx < rows.length; idx++) {
    let prize: string | null = null;
    if (idx === 0) prize = "GRAND PRIZE - Premium Detail + $100";
    else if (idx <= RUNNERS_UP) prize = "Runner-up - 40% off";
    else if (idx <= RUNNERS_UP + RESERVES) prize = `Reserve #${idx - RUNNERS_UP}`;

    // Clear stale prizes from any prior draw, set new ones.
    const next = { ...rows[idx].tag!, draw_id: drawId } as ReturnType<typeof parseEntryTag> & object;
    if (prize) (next as { prize?: string }).prize = prize; else delete (next as { prize?: string }).prize;
    await supabase
      .from("leads")
      .update({ internal_notes: replaceEntryTag(rows[idx].internal_notes, next!) })
      .eq("id", rows[idx].id);

    if (prize) {
      const c = (rows[idx].contacts ?? {}) as { full_name?: string; first_name?: string; last_name?: string; email?: string; phone?: string };
      const v = (rows[idx].vehicles ?? {}) as { year?: string; make?: string; model?: string };
      winners.push({
        prize,
        name: c.full_name || [c.first_name, c.last_name].filter(Boolean).join(" "),
        email: c.email ?? null,
        phone: c.phone ?? null,
        vehicle: [v.year, v.make, v.model].filter(Boolean).join(" "),
      });
    }
  }

  return NextResponse.json({ ok: true, drawn_from: valid.length, draw_id: drawId, winners });
}
