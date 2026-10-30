/**
 * Giveaway second prize (WLG Oct 2026). Every entrant except the grand prize
 * winner(s) wins it (Max, 28 Oct): Ceramic Coating Gold for the Bronze price,
 * plus a free full-car glass ceramic coating, a take-home CarPro sealant
 * bottle and a free maintenance wash. Book by 12pm Mon 2 Nov, work done
 * within 3 months. No public copy names the prize; only this email does.
 *
 * The email links to crm.../claim/<entry code>, which mints the claim link and
 * redirects. The claim link opens the Wellington booking form with Gold and the free
 * glass add-on picked, the SECONDPRIZE code applied (Gold priced at Bronze,
 * New-Booking-System constants.ts) and the entrant's details prefilled from
 * a booking_prefill token. The booking intake grants the maintenance wash as
 * a customer credit and checks the booking against the entrant list
 * (secondPrizeCheck below).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { signActionToken } from "@/lib/auth/signedTokens";
import { GIVEAWAY, parseEntryTag } from "@/lib/giveaway/wlgOct2026";

export const SECOND_PRIZE = {
  code: "SECONDPRIZE",
  // Midnight at the end of Monday 2 Nov NZ (Max, 30 Oct).
  deadline: new Date("2026-11-02T23:59:59+13:00"),
  deadlineLabel: "11:59pm Monday 2 November",
  bookingUrl: "https://cleancarcollective.co.nz/make-a-booking/",
  claimBase: "https://crm.cleancarcollective.co.nz/claim/",
};

export const isGrandPrize = (prize: string | null | undefined) => !!prize && prize.startsWith("GRAND PRIZE");

/** "Sam T." from a contact; null when there's no first name. */
export function winnerLabel(c: { first_name?: string | null; last_name?: string | null; full_name?: string | null } | null | undefined): string | null {
  const parts = (c?.full_name || "").trim().split(/\s+/).filter(Boolean);
  const first = c?.first_name?.trim() || parts[0] || "";
  const last = c?.last_name?.trim() || (parts.length > 1 ? parts[parts.length - 1] : "");
  if (!first) return null;
  return last ? `${first} ${last[0].toUpperCase()}.` : first;
}

/** Per-entrant claim link. The prefill token lasts until a day after the deadline. */
export function claimUrl(leadId: string | null, shopId: string): string {
  const u = new URL(SECOND_PRIZE.bookingUrl);
  u.searchParams.set("service", "ceramic-gold");
  u.searchParams.set("freeaddon", "glass-ceramic-full");
  u.searchParams.set("code", SECOND_PRIZE.code);
  if (leadId) {
    const ttl = Math.max(3600, Math.round((SECOND_PRIZE.deadline.getTime() + 864e5 - Date.now()) / 1000));
    u.searchParams.set("pf", signActionToken({ a: "booking_prefill", r: leadId, s: shopId }, ttl));
  }
  return u.toString();
}

/** Short per-entrant claim link (app/claim/[code]): one clean link in a plain-text email. */
export function claimShortUrl(code: string | null | undefined): string {
  return `${SECOND_PRIZE.claimBase}${code || "PRIZE"}`;
}

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Written like a personal email: an HTML/image-style version landed in Gmail's
 * Promotions tab (Max, 30 Oct). The HTML part is bare (no styling, images or
 * buttons) and exists only so the claim link and the unsubscribe are short
 * words, not long URLs. The unsubscribe stays: NZ's Unsolicited Electronic
 * Messages Act needs one, and Postmark appends its own if it's missing.
 */
export function renderSecondPrizeEmail(p: { firstName: string; winner: string | null; claimUrl: string }): { subject: string; text: string; html: string } {
  // Copy: Max, 30 Oct 2026. `winner` is no longer named in the email.
  const first = p.firstName || "Hi";
  const opener = p.firstName ? `${first}, I've got good news…` : `I've got good news…`;
  const won = `You won! The Clean Car Collective giveaway draw is done, and you've won our second place prize!`;
  const what = `Get a Gold ceramic coating (worth up to $1,265) for the price of our Bronze coating package, alongside a bunch of freebies! That takes your warranty from 1 year to 5 years and you also get these, completely free:`;
  const items = [
    `a full-car glass ceramic coating ($250+ in value)`,
    `a free bottle of CarPro ceramic sealant to take home ($60 value)`,
    `a bonus maintenance wash to keep the coating at its best ($200+ in value)`,
  ];
  const value = `That's up to $1,020 of value for free, depending on your car.`;
  const after = `Your details are filled in and you'll see your discounted price before you book.`;
  const deadline = `Book by ${SECOND_PRIZE.deadlineLabel}. The work can be done any time in the next 3 months. Prices are +GST.`;

  const text = [
    opener, ``, won, ``, `What you won:`, what, ...items.map((i) => `- ${i}`), ``, value, ``,
    `Claim your prize here: ${p.claimUrl}`, after, ``, deadline, ``,
    `Clean Car Collective`, `8 Ebor Street, Te Aro, Wellington`, ``, `Unsubscribe: {{{ pm:unsubscribe }}}`,
  ].join("\n");

  const html = `<!doctype html><html><body>
<p>${esc(opener)}</p>
<p>${esc(won)}</p>
<p>What you won:<br>
${esc(what)}<br>
${items.map((i) => `- ${esc(i)}`).join("<br>\n")}</p>
<p>${esc(value)}</p>
<p><a href="${esc(p.claimUrl)}">Claim your prize here</a>. ${esc(after)}</p>
<p>${esc(deadline)}</p>
<p>Clean Car Collective<br>8 Ebor Street, Te Aro, Wellington</p>
<p><a href="{{{ pm:unsubscribe }}}">Unsubscribe</a></p>
</body></html>`;
  return { subject: "You won second prize in our giveaway", text, html };
}

/**
 * Second-prize SMS (Max's copy, 30 Oct). Plain GSM-7 characters only (straight
 * apostrophe, "..."), so it costs 2 segments instead of 5 UCS-2 ones.
 */
export function renderSecondPrizeSms(p: { firstName: string; claimUrl: string }): string {
  const opener = p.firstName ? `${p.firstName}, I've got good news...` : `I've got good news...`;
  return `${opener} You won! The Clean Car Collective giveaway draw is done, and you've won our second place prize! Click the link below to claim your freebies and $1020 of savings: ${p.claimUrl} Reply STOP to opt out`;
}

/**
 * Booking intake: a line for staff saying whether a SECONDPRIZE booking came
 * from a real non-winning entrant, and whether it was booked in time.
 */
export async function secondPrizeCheck(supabase: SupabaseClient, shopId: string, contactId: string, now = new Date()): Promise<string> {
  const { data } = await supabase
    .from("leads")
    .select("internal_notes")
    .eq("shop_id", shopId)
    .eq("contact_id", contactId)
    .like("internal_notes", `[giveaway:${GIVEAWAY.key}]%`)
    .limit(5);
  const tags = (data ?? []).map((r) => parseEntryTag(r.internal_notes as string | null)).filter(Boolean);
  const late = now.getTime() > SECOND_PRIZE.deadline.getTime() ? ` Booked AFTER the ${SECOND_PRIZE.deadlineLabel} deadline.` : "";
  if (tags.length === 0) return `Giveaway check: this contact is NOT on the giveaway entrant list. Check before honouring the second prize.${late}`;
  if (tags.some((t) => isGrandPrize(t!.prize))) return `Giveaway check: this contact is a GRAND PRIZE winner, not a second prize winner. Check with Max.${late}`;
  return `Giveaway check: entrant ${tags[0]!.code ?? ""} confirmed.${late}`.replace("  ", " ");
}
