/**
 * GET /api/cron/giveaway-drip   (Bearer CRON_SECRET)
 *
 * Sends whichever giveaway touches are due (see lib/giveaway/drip.ts) to
 * every valid entrant who hasn't had them. Idempotent: a marker line goes
 * into the lead's internal_notes per touch. Bounded per run (email batch
 * via Postmark, SMS via TNZ with a concurrency cap) so it fits inside the
 * function limit; GitHub Actions calls it every 20 minutes through the NZ
 * day, so anything left over is picked up by the next run.
 *
 * Query flags (test ones only act on test entries, never real entrants):
 *   ?dry=1          report what would send, send nothing
 *   ?test=1         act on test entries only (tag.test === true)
 *   ?touch=KEY      with test=1: force one touch regardless of its window
 *   ?sms=0          with test=1: skip the SMS leg (test entries use made-up numbers)
 */

import { NextRequest, NextResponse } from "next/server";
import { getPostmarkClient } from "@/lib/email/postmarkClient";
import { sendTnzSms } from "@/lib/sms/tnzClient";
import { hasSmsOptOut } from "@/lib/sms/consent";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { GIVEAWAY, parseEntryTag, referralCounts, ticketsFor, type EntryTag } from "@/lib/giveaway/wlgOct2026";
import { TOUCHES, FROM_LINE, appendSentMarker, sentTouches, renderCountdownEmail, renderCountdownSms, type DripEntrant, type Touch, type TouchKey } from "@/lib/giveaway/drip";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PER_RUN = 150;          // entrants per touch per run
const SMS_CONCURRENCY = 8;
const BROADCAST_STREAM = process.env.POSTMARK_BROADCAST_STREAM || "broadcast";

type Row = {
  id: string;
  internal_notes: string | null;
  contacts: { id: string; first_name: string | null; full_name: string | null; email: string | null; phone: string | null } | null;
};

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = req.nextUrl.searchParams;
  const test = q.get("test") === "1";
  const dry = q.get("dry") === "1";
  const forced = test ? (q.get("touch") as TouchKey | null) : null;
  const smsOff = test && q.get("sms") === "0";
  const now = new Date();

  const due: Touch[] = TOUCHES.filter((t) => (forced ? t.key === forced : t.enabled && now >= t.sendAt && now <= t.validUntil));
  if (due.length === 0) return NextResponse.json({ ok: true, now: now.toISOString(), due: [] });

  const supabase = getSupabaseAdminClient();
  const { data: shop } = await supabase.from("shops").select("id").eq("slug", GIVEAWAY.shopSlug).maybeSingle();
  if (!shop) return NextResponse.json({ error: "shop not found" }, { status: 500 });

  const { data } = await supabase
    .from("leads")
    .select("id, internal_notes, contacts(id, first_name, full_name, email, phone)")
    .eq("shop_id", shop.id)
    .eq("source", GIVEAWAY.leadSource)
    .ilike("internal_notes", `%[giveaway:${GIVEAWAY.key}]%`)
    .limit(5000);
  const entries = ((data ?? []) as unknown as Row[])
    .map((r) => ({ ...r, tag: parseEntryTag(r.internal_notes) as EntryTag }))
    .filter((r) => r.tag && r.tag.test === test && r.tag.code);
  const counts = referralCounts(entries);

  const report: Record<string, unknown>[] = [];
  for (const touch of due) {
    const pending = entries.filter((r) => !sentTouches(r.internal_notes).has(touch.key));
    const batch = pending.slice(0, PER_RUN);
    const entrants: Array<{ row: typeof batch[number]; e: DripEntrant }> = batch.map((row) => ({
      row,
      e: {
        firstName: row.contacts?.first_name || (row.contacts?.full_name || "").split(" ")[0] || "",
        email: row.contacts?.email ?? null,
        phone: row.contacts?.phone ?? null,
        code: row.tag.code!,
        tickets: ticketsFor(row.tag, counts),
        referrals: counts.get(row.tag.code!) ?? 0,
      },
    }));

    if (dry) {
      report.push({ touch: touch.key, pending: pending.length, would_send: entrants.length, sample: entrants.slice(0, 3).map(({ e }) => ({ ...e, email: e.email ? "set" : null, phone: e.phone ? "set" : null, sms: renderCountdownSms(e, now), subject: renderCountdownEmail(e, now).subject })) });
      continue;
    }

    // Email: one Postmark batch call on the broadcast stream.
    const emailResult = new Map<string, string>();
    if (touch.email) {
      const withEmail = entrants.filter(({ e }) => e.email);
      if (withEmail.length) {
        try {
          const res = await getPostmarkClient().sendEmailBatch(withEmail.map(({ e }) => {
            const m = renderCountdownEmail(e, now);
            return { From: FROM_LINE, To: e.email!, Subject: m.subject, TextBody: m.text, HtmlBody: m.html, MessageStream: BROADCAST_STREAM, TrackOpens: false, TrackLinks: "None" as never, Tag: `giveaway-${touch.key}`, Metadata: { touch: touch.key, code: e.code } };
          }));
          res.forEach((r, i) => emailResult.set(withEmail[i].row.id, r.ErrorCode === 0 ? "sent" : `failed:${r.ErrorCode}`));
        } catch (err) {
          console.error("giveaway drip email batch failed", err);
          withEmail.forEach(({ row }) => emailResult.set(row.id, "failed:batch"));
        }
      }
    }

    // SMS: marketing opt-out honoured, bounded concurrency.
    const smsResult = new Map<string, string>();
    if (touch.sms && !smsOff) {
      await mapLimit(entrants.filter(({ e }) => e.phone), SMS_CONCURRENCY, async ({ row, e }) => {
        if (await hasSmsOptOut(row.contacts?.id)) { smsResult.set(row.id, "skipped:optout"); return; }
        const r = await sendTnzSms(e.phone!, renderCountdownSms(e, now));
        smsResult.set(row.id, r.success ? "sent" : `failed:${(r.error || "").slice(0, 40)}`);
      });
    }

    // Markers. Written even on failure so a bad address isn't retried every 20 minutes.
    await mapLimit(entrants, 10, async ({ row }) => {
      const notes = appendSentMarker(row.internal_notes, touch.key, { email: emailResult.get(row.id) ?? (touch.email ? "no-email" : "off"), sms: smsResult.get(row.id) ?? (smsOff ? "skipped:test" : touch.sms ? "no-phone" : "off") });
      await supabase.from("leads").update({ internal_notes: notes }).eq("id", row.id);
    });

    const tally = (m: Map<string, string>) => { const t: Record<string, number> = {}; for (const v of m.values()) t[v.split(":")[0]] = (t[v.split(":")[0]] ?? 0) + 1; return t; };
    report.push({ touch: touch.key, processed: entrants.length, remaining: pending.length - entrants.length, email: tally(emailResult), sms: tally(smsResult) });
  }

  return NextResponse.json({ ok: true, now: now.toISOString(), test, dry, report });
}
