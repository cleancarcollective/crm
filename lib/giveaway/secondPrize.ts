/**
 * Giveaway second prize (WLG Oct 2026). Every entrant except the grand prize
 * winner(s) wins it (Max, 28 Oct): Ceramic Coating Gold for the Bronze price,
 * plus a free full-car glass ceramic coating, a take-home CarPro sealant
 * bottle and a free maintenance wash. Book by 12pm Mon 2 Nov, work done
 * within 3 months. No public copy names the prize; only this email does.
 *
 * The claim link opens the Wellington booking form with Gold and the free
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
  deadline: new Date("2026-11-02T12:00:00+13:00"),
  deadlineLabel: "12pm Monday 2 November",
  bookingUrl: "https://cleancarcollective.co.nz/make-a-booking/",
};

const escapeHtml = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

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

const ITEMS = [
  "<strong>Free upgrade to Gold.</strong> Your warranty goes from 1 year to 5 years.",
  "<strong>Free full-car glass ceramic coating</strong> ($250 value)",
  "<strong>A bottle of CarPro ceramic sealant</strong> to take home ($60 value)",
  "<strong>A free maintenance wash</strong> to keep the coating at its best ($200 value)",
];

export function renderSecondPrizeEmail(p: { firstName: string; winner: string | null; claimUrl: string }): { subject: string; text: string; html: string } {
  const subject = "You won second prize in our giveaway!";
  const preheader = "A Gold ceramic coating for the Bronze price. Claim it before 12pm Monday.";
  const first = p.firstName || "there";
  const drawLine = p.winner
    ? `The draw is done. Our grand prize went to ${p.winner.replace(/\.$/, "")}. And you've won second prize:`
    : `The draw is done, and you've won second prize:`;
  const plain = (s: string) => s.replace(/<[^>]+>/g, "");

  const text = [
    `Hi ${first},`,
    ``,
    `${drawLine} a Gold ceramic coating for the Bronze price, plus extras on us.`,
    ``,
    `Book a Bronze ceramic coating and we'll turn it into Gold:`,
    ...ITEMS.map((i) => `+ ${plain(i)}`),
    ``,
    `That's up to $1,020 free, depending on your car. You pay the Bronze price. Claim it here (your price shows for your car):`,
    p.claimUrl,
    ``,
    `Book by ${SECOND_PRIZE.deadlineLabel}. The work can be done any time in the next 3 months.`,
    ``,
    `Questions about which coating suits your car? Just reply to this email and we'll help.`,
    ``,
    `Clean Car Collective, 8 Ebor Street, Te Aro, Wellington. Prices are +GST.`,
    `Don't want giveaway updates? Unsubscribe: {{{ pm:unsubscribe }}}`,
  ].join("\n");

  const lis = ITEMS.map((i) => `<tr><td style="padding:0 10px 9px 0;vertical-align:top;font-size:15px;color:#111;font-weight:800;">+</td><td style="padding:0 0 9px;font-size:15px;line-height:1.45;color:#222;">${i}</td></tr>`).join("");
  const href = escapeHtml(p.claimUrl);

  const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#E5E4E2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#E5E4E2;padding:28px 12px;"><tr><td align="center">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;">
      <tr><td style="background:#000000;padding:22px 28px;color:#ffffff;font-size:13px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;">Clean Car Collective</td></tr>
      <tr><td style="padding:30px 28px 6px;">
        <p style="margin:0 0 6px;font-size:12px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:#8a7a00;">Second prize winner</p>
        <p style="margin:0 0 14px;font-size:24px;font-weight:800;line-height:1.2;color:#111;">You won second prize, ${escapeHtml(first)}!</p>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#333;">${escapeHtml(drawLine)} <strong>a Gold ceramic coating for the Bronze price</strong>, plus extras on us.</p>
      </td></tr>
      <tr><td style="padding:8px 28px 10px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fffbe6;border:2px solid #f7e04a;border-radius:14px;"><tr><td style="padding:22px 22px 20px;">
          <p style="margin:0 0 6px;font-size:11px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:#111;">Your second prize</p>
          <p style="margin:0 0 14px;font-size:19px;font-weight:800;line-height:1.3;color:#111;">Book a Bronze ceramic coating and we'll turn it into Gold.</p>
          <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 12px;">${lis}</table>
          <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#444;">That's up to <strong>$1,020 free</strong>, depending on your car. You pay the Bronze price. Tap below to see your exact price.</p>
          <a href="${href}" style="display:inline-block;background:#111;color:#ffffff;font-size:15px;font-weight:700;padding:13px 22px;border-radius:10px;text-decoration:none;">Claim my prize</a>
          <p style="margin:14px 0 0;font-size:13px;font-weight:700;color:#8a7a00;">Book by ${SECOND_PRIZE.deadlineLabel}</p>
        </td></tr></table>
      </td></tr>
      <tr><td style="padding:12px 28px 30px;">
        <p style="margin:0 0 16px;font-size:14px;line-height:1.55;color:#555;">The work can be done any time in the next 3 months. Questions about which coating suits your car? Just reply to this email and we'll help.</p>
        <p style="margin:0;font-size:12px;line-height:1.6;color:#888;">Clean Car Collective, 8 Ebor Street, Te Aro, Wellington. You're getting this because you entered our Wellington giveaway. Prices shown are +GST.<br />Don't want giveaway updates? <a href="{{{ pm:unsubscribe }}}" style="color:#888;">Unsubscribe</a>.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
  return { subject, text, html };
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
