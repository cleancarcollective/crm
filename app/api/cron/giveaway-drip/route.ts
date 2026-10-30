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
 *   ?preview=post_draw&to=EMAIL[&sms_to=PHONE]
 *                   send ONE second-prize email to EMAIL, built for the entry with that
 *                   email when there is one (so the claim link prefills it), else for a
 *                   made-up entrant. Writes no markers. .github/workflows/giveaway-preview.yml
 *
 * post_draw (lib/giveaway/secondPrize.ts) waits for the draw (a GRAND PRIZE tag) and goes
 * to every entrant except the grand prize winner(s), each with their own claim link.
 */

import { NextRequest, NextResponse } from "next/server";
import { ServerClient } from "postmark";
import { getPostmarkClient } from "@/lib/email/postmarkClient";
import { sendTnzSms } from "@/lib/sms/tnzClient";
import { hasSmsOptOut } from "@/lib/sms/consent";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { fetchAllGiveawayLeads } from "@/lib/giveaway/fetchEntries";
import { GIVEAWAY, parseEntryTag, referralCounts, ticketsFor, type EntryTag } from "@/lib/giveaway/wlgOct2026";
import { TOUCHES, FROM_LINE, REPLY_TO, appendSentMarker, sentTouches, renderCountdownEmail, renderCountdownSms, type DripEntrant, type Touch, type TouchKey } from "@/lib/giveaway/drip";
import { claimShortUrl, isGrandPrize, renderSecondPrizeEmail, renderSecondPrizeSms, winnerLabel } from "@/lib/giveaway/secondPrize";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PER_RUN = 150;          // entrants per touch per run
const SMS_CONCURRENCY = 8;
const BROADCAST_STREAM = process.env.POSTMARK_BROADCAST_STREAM || "broadcast";
// Bulk sends can run on a different Postmark server than transactional mail.
// Set POSTMARK_BROADCAST_TOKEN to point the drip at it; otherwise it shares
// POSTMARK_SERVER_TOKEN.
let broadcastClient: ServerClient | null = null;
function getBroadcastClient() {
  const t = process.env.POSTMARK_BROADCAST_TOKEN;
  if (!t) return getPostmarkClient();
  if (!broadcastClient) broadcastClient = new ServerClient(t);
  return broadcastClient;
}

type Row = {
  id: string;
  internal_notes: string | null;
  contacts: { id: string; first_name: string | null; last_name: string | null; full_name: string | null; email: string | null; phone: string | null } | null;
};
const firstNameOf = (c: Row["contacts"]) => c?.first_name || (c?.full_name || "").split(" ")[0] || "";

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
  const preview = q.get("preview");
  const previewTo = (q.get("to") || "").trim().toLowerCase();
  const previewSmsTo = (q.get("sms_to") || "").trim();
  if (preview && (preview !== "post_draw" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(previewTo))) {
    return NextResponse.json({ error: "preview=post_draw needs a valid to=EMAIL" }, { status: 400 });
  }

  const due: Touch[] = TOUCHES.filter((t) => (forced ? t.key === forced : t.enabled && now >= t.sendAt && now <= t.validUntil));
  if (due.length === 0 && !preview) return NextResponse.json({ ok: true, now: now.toISOString(), due: [] });

  const supabase = getSupabaseAdminClient();
  const { data: shop } = await supabase.from("shops").select("id").eq("slug", GIVEAWAY.shopSlug).maybeSingle();
  if (!shop) return NextResponse.json({ error: "shop not found" }, { status: 500 });

  const data = await fetchAllGiveawayLeads<Row>(
    supabase,
    shop.id,
    "id, internal_notes, contacts(id, first_name, last_name, full_name, email, phone)",
  );

  // The draw: grand prize winner(s), named in the second-prize email and left out of it.
  const tagged = data.map((r) => ({ ...r, tag: parseEntryTag(r.internal_notes) as EntryTag }));
  const grand = tagged.filter((r) => r.tag && !r.tag.test && isGrandPrize(r.tag.prize));
  const mainGrand = grand.find((r) => !(r.tag.prize || "").includes("referral bonus")) ?? grand[0];
  const winner = mainGrand ? winnerLabel(mainGrand.contacts) : null;

  if (preview) {
    const row = tagged.find((r) => r.tag && (r.contacts?.email || "").toLowerCase() === previewTo) ?? null;
    const m = renderSecondPrizeEmail({ firstName: firstNameOf(row?.contacts ?? null) || "Max", winner, claimUrl: claimShortUrl(row?.tag.code) });
    try {
      const r = await getBroadcastClient().sendEmail({ From: FROM_LINE, ReplyTo: REPLY_TO, To: previewTo, Subject: `[TEST] ${m.subject}`, TextBody: m.text, HtmlBody: m.html, MessageStream: BROADCAST_STREAM, TrackOpens: false, TrackLinks: "None" as never, Tag: "giveaway-post_draw-preview" });
      const smsText = renderSecondPrizeSms({ firstName: firstNameOf(row?.contacts ?? null) || "Max", claimUrl: claimShortUrl(row?.tag.code) });
      const sms = previewSmsTo ? await sendTnzSms(previewSmsTo, smsText) : null;
      return NextResponse.json({ ok: true, preview, to: previewTo, from: FROM_LINE, matched_entry: !!row, prefilled: !!row, winner, drawn: grand.length > 0, postmark: { ErrorCode: r.ErrorCode, Message: r.Message }, sms: sms ? { success: sms.success, error: sms.success ? null : sms.error, chars: smsText.length } : null });
    } catch (err) {
      return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 502 });
    }
  }
  const entries = data
    .map((r) => ({ ...r, tag: parseEntryTag(r.internal_notes) as EntryTag }))
    .filter((r) => r.tag && r.tag.test === test && r.tag.code);
  const counts = referralCounts(entries);

  const report: Record<string, unknown>[] = [];
  for (const touch of due) {
    // The second-prize email waits for the draw and skips the grand prize winner(s).
    if (touch.key === "post_draw" && grand.length === 0) { report.push({ touch: touch.key, waiting: "no draw yet" }); continue; }
    const pending = entries.filter((r) => !sentTouches(r.internal_notes).has(touch.key) && !(touch.key === "post_draw" && isGrandPrize(r.tag.prize)));
    const batch = pending.slice(0, PER_RUN);
    const entrants: Array<{ row: typeof batch[number]; e: DripEntrant }> = batch.map((row) => ({
      row,
      e: {
        firstName: firstNameOf(row.contacts),
        email: row.contacts?.email ?? null,
        phone: row.contacts?.phone ?? null,
        code: row.tag.code!,
        tickets: ticketsFor(row.tag, counts),
        referrals: counts.get(row.tag.code!) ?? 0,
      },
    }));

    if (dry) {
      report.push({ touch: touch.key, pending: pending.length, would_send: entrants.length, sample: entrants.slice(0, 3).map(({ e }) => ({ ...e, email: e.email ? "set" : null, phone: e.phone ? "set" : null, sms: touch.key === "post_draw" ? renderSecondPrizeSms({ firstName: e.firstName, claimUrl: claimShortUrl(e.code) }) : renderCountdownSms(e, now), subject: touch.key === "post_draw" ? "You won second prize in our giveaway" : renderCountdownEmail(e, now).subject })) });
      continue;
    }

    // Email: one Postmark batch call on the broadcast stream.
    const emailResult = new Map<string, string>();
    const postmarkDebug: Array<{ ErrorCode: number; Message: string; MessageID?: string }> = [];
    if (touch.email) {
      const withEmail = entrants.filter(({ e }) => e.email);
      if (withEmail.length) {
        try {
          const res = await getBroadcastClient().sendEmailBatch(withEmail.map(({ row, e }) => {
            if (touch.key === "post_draw") {
              // Bare, personal-looking email (lib/giveaway/secondPrize.ts)
              const m = renderSecondPrizeEmail({ firstName: e.firstName, winner, claimUrl: claimShortUrl(e.code) });
              return { From: FROM_LINE, ReplyTo: REPLY_TO, To: e.email!, Subject: m.subject, TextBody: m.text, HtmlBody: m.html, MessageStream: BROADCAST_STREAM, TrackOpens: false, TrackLinks: "None" as never, Tag: `giveaway-${touch.key}`, Metadata: { touch: touch.key, code: e.code } };
            }
            const m = renderCountdownEmail(e, now);
            return { From: FROM_LINE, ReplyTo: REPLY_TO, To: e.email!, Subject: m.subject, TextBody: m.text, HtmlBody: m.html, MessageStream: BROADCAST_STREAM, TrackOpens: false, TrackLinks: "None" as never, Tag: `giveaway-${touch.key}`, Metadata: { touch: touch.key, code: e.code } };
          }));
          res.forEach((r, i) => emailResult.set(withEmail[i].row.id, r.ErrorCode === 0 ? `sent:${(r.MessageID || "").slice(0, 8)}` : `failed:${r.ErrorCode}`));
          if (test) postmarkDebug.push(...res.map((r) => ({ ErrorCode: r.ErrorCode, Message: r.Message, MessageID: r.MessageID })));
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
        const text = touch.key === "post_draw" ? renderSecondPrizeSms({ firstName: e.firstName, claimUrl: claimShortUrl(e.code) }) : renderCountdownSms(e, now);
        const r = await sendTnzSms(e.phone!, text);
        smsResult.set(row.id, r.success ? "sent" : `failed:${(r.error || "").slice(0, 40)}`);
      });
    }

    // Markers. Written even on failure so a bad address isn't retried every 20 minutes.
    await mapLimit(entrants, 10, async ({ row }) => {
      const notes = appendSentMarker(row.internal_notes, touch.key, { email: emailResult.get(row.id) ?? (touch.email ? "no-email" : "off"), sms: smsResult.get(row.id) ?? (smsOff ? "skipped:test" : touch.sms ? "no-phone" : "off") });
      await supabase.from("leads").update({ internal_notes: notes }).eq("id", row.id);
    });

    const tally = (m: Map<string, string>) => { const t: Record<string, number> = {}; for (const v of m.values()) t[v.split(":")[0]] = (t[v.split(":")[0]] ?? 0) + 1; return t; };
    report.push({ touch: touch.key, processed: entrants.length, remaining: pending.length - entrants.length, email: tally(emailResult), sms: tally(smsResult), ...(test ? { postmark: postmarkDebug, stream: BROADCAST_STREAM, token: process.env.POSTMARK_BROADCAST_TOKEN ? "POSTMARK_BROADCAST_TOKEN" : "POSTMARK_SERVER_TOKEN" } : {}) });
  }

  return NextResponse.json({ ok: true, now: now.toISOString(), test, dry, report });
}
