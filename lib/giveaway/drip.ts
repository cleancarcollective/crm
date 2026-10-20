/**
 * Giveaway countdown drip. Hormozi's "email and text how many days are
 * left" play, with the referral link as the ask: every touch reminds the
 * entrant how many tickets they hold and that each friend adds one.
 *
 * Touches are keyed by date. The cron route (/api/cron/giveaway-drip) runs
 * several times a day via GitHub Actions and once a day via Vercel; a touch
 * fires once per entrant the first time the route runs inside its window,
 * and the marker written to the lead's internal_notes makes it idempotent.
 *
 * Email goes through Postmark's broadcast stream (bulk, Postmark-managed
 * unsubscribe), never the transactional Gmail SMTP path. SMS goes through
 * TNZ and honours the marketing opt-out register.
 */

import { GIVEAWAY, shareUrlFor } from "@/lib/giveaway/wlgOct2026";

export type TouchKey = "countdown_5d" | "countdown_2d" | "countdown_last" | "post_draw";

export type Touch = {
  key: TouchKey;
  /** Earliest send (NZ). Fires on the first cron run inside [sendAt, validUntil]. */
  sendAt: Date;
  /** After this the touch is stale ("5 days left" sent 2 days late is wrong) and is skipped. */
  validUntil: Date;
  email: boolean;
  sms: boolean;
  enabled: boolean;
  note: string;
};

export const TOUCHES: Touch[] = [
  { key: "countdown_5d",   sendAt: new Date("2026-10-24T10:30:00+13:00"), validUntil: new Date("2026-10-24T20:00:00+13:00"), email: true, sms: true, enabled: true,  note: "Sat 24 Oct, 5 days left" },
  { key: "countdown_2d",   sendAt: new Date("2026-10-27T10:30:00+13:00"), validUntil: new Date("2026-10-27T20:00:00+13:00"), email: true, sms: true, enabled: true,  note: "Tue 27 Oct, 2 days left" },
  { key: "countdown_last", sendAt: new Date("2026-10-29T10:30:00+13:00"), validUntil: new Date("2026-10-29T20:00:00+13:00"), email: true, sms: true, enabled: true,  note: "Thu 29 Oct, closes tonight" },
  // Winners announced + "you've won a second prize, 72h to claim". Copy and the
  // booking-form claim code still to be confirmed with Max, so it is off.
  { key: "post_draw",      sendAt: new Date("2026-10-30T12:00:00+13:00"), validUntil: new Date("2026-10-31T20:00:00+13:00"), email: true, sms: true, enabled: false, note: "Fri 30 Oct, winners + second prize claim (OFF until copy approved)" },
];

// Matches the giveaway page and the ads: "Win a Free Premium Detail + $100 Cash", over $800 in value.
export const PRIZE_SHORT = "free Premium Detail + $100 cash";
export const PRIZE_LONG = "a free Premium Detail plus $100 cash, over $800 in value, with ceramic protection added on top";
export const SECOND_PRIZES = "There's more than one winner: second prizes are drawn on Friday 30 October too.";
export const BOOK_URL = "https://cleancarcollective.co.nz/make-a-booking/";
export const FROM_LINE = "Clean Car Collective <hello@cleancarcollective.co.nz>";

/* ---- Sent markers, one line per touch in leads.internal_notes ---- */
const SENT_PREFIX = "[giveaway-sent:";
export function sentTouches(internalNotes: string | null | undefined): Set<TouchKey> {
  const out = new Set<TouchKey>();
  for (const line of (internalNotes ?? "").split("\n")) {
    if (!line.startsWith(SENT_PREFIX)) continue;
    const key = line.slice(SENT_PREFIX.length, line.indexOf("]"));
    if (key) out.add(key as TouchKey);
  }
  return out;
}
export function appendSentMarker(internalNotes: string | null | undefined, key: TouchKey, result: { email: string; sms: string }): string {
  const line = `${SENT_PREFIX}${key}] ${new Date().toISOString()} email=${result.email} sms=${result.sms}`;
  return [(internalNotes ?? "").trim(), line].filter(Boolean).join("\n");
}

/* ---- Copy ---- */
const nzDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" }); // YYYY-MM-DD
export function daysLeft(now: Date): number {
  const [y1, m1, d1] = nzDate(now).split("-").map(Number);
  const [y2, m2, d2] = nzDate(GIVEAWAY.closes).split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 864e5);
}
export function daysLeftLabel(now: Date): string {
  const n = daysLeft(now);
  if (n <= 0) return "Last day";
  if (n === 1) return "1 day left";
  return `${n} days left`;
}

export type DripEntrant = { firstName: string; email: string | null; phone: string | null; code: string; tickets: number; referrals: number };

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function shareText(code: string): string {
  return `I just entered Clean Car Collective's Wellington giveaway to win a free Premium Detail plus $100 cash (over $800 in value). Free to enter, takes 30 seconds, and if you win the grand prize I win one too: ${shareUrlFor(code)}`;
}

export function renderCountdownSms(e: DripEntrant, now: Date): string {
  const label = daysLeftLabel(now);
  const closing = daysLeft(now) <= 0 ? "Entries close 11:59pm tonight." : "Entries close Thu 29 Oct, 11:59pm.";
  return `Clean Car Collective giveaway: ${label}. You have ${plural(e.tickets, "entry", "entries")} to win a ${PRIZE_SHORT}. Every friend who enters with your link = +1 entry: ${shareUrlFor(e.code)} ${closing}`;
}

export function renderCountdownEmail(e: DripEntrant, now: Date): { subject: string; text: string; html: string } {
  const label = daysLeftLabel(now);
  const url = shareUrlFor(e.code);
  const wa = `https://wa.me/?text=${encodeURIComponent(shareText(e.code))}`;
  const closing = daysLeft(now) <= 0 ? "Entries close at 11:59pm tonight" : "Entries close Thursday 29 October at 11:59pm";
  const subject = `${label}: you have ${plural(e.tickets, "entry", "entries")} in the giveaway`;
  const friendsLine = e.referrals > 0 ? `${plural(e.referrals, "friend has", "friends have")} entered through your link so far. Nice work.` : "Nobody has used your link yet. One share could double your chances.";
  const first = e.firstName || "there";

  const text = [
    `Hi ${first},`,
    ``,
    `${label} in the Clean Car Collective Wellington giveaway. You have ${plural(e.tickets, "entry", "entries")} in the draw for ${PRIZE_LONG}. ${closing}. ${SECOND_PRIZES}`,
    ``,
    `Want more chances? Share your link:`,
    url,
    ``,
    `Every friend who enters with your link gives you an extra entry. If a friend you referred wins the grand prize, you win one too. ${friendsLine}`,
    ``,
    `Can't wait to win one? Book a detail now and you're still in the draw: ${BOOK_URL}`,
    ``,
    `Clean Car Collective, 8 Ebor Street, Te Aro, Wellington`,
    `Don't want giveaway updates? Unsubscribe: {{{ pm:unsubscribe }}}`,
  ].join("\n");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#E5E4E2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#E5E4E2;padding:28px 12px;"><tr><td align="center">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;">
      <tr><td style="background:#000000;padding:22px 28px;color:#ffffff;font-size:13px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;">Clean Car Collective</td></tr>
      <tr><td style="padding:30px 28px 6px;">
        <p style="margin:0 0 6px;font-size:12px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:#8a7a00;">${escapeHtml(label)}</p>
        <p style="margin:0 0 14px;font-size:24px;font-weight:800;line-height:1.2;color:#111;">You have ${plural(e.tickets, "entry", "entries")} in the draw, ${escapeHtml(first)}.</p>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#333;">The grand prize is a <strong>${PRIZE_SHORT}</strong>, over $800 in value, with ceramic protection added on top. ${closing}.</p>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#333;">${SECOND_PRIZES}</p>
      </td></tr>
      <tr><td style="padding:8px 28px 10px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fffbe6;border:2px solid #f7e04a;border-radius:14px;"><tr><td style="padding:22px 22px 20px;">
          <p style="margin:0 0 6px;font-size:11px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:#111;">Want more chances to win?</p>
          <p style="margin:0 0 12px;font-size:17px;font-weight:800;line-height:1.3;color:#111;">Share your link. Every friend who enters = 1 extra entry for you.</p>
          <p style="margin:0 0 14px;font-size:14px;line-height:1.5;color:#444;">If a friend you referred wins the grand prize, you win one too. ${escapeHtml(friendsLine)}</p>
          <p style="margin:0 0 16px;padding:12px 14px;background:#ffffff;border:1px solid #e6dca6;border-radius:10px;font-size:14px;word-break:break-all;"><a href="${url}" style="color:#111;font-weight:600;text-decoration:none;">${url}</a></p>
          <a href="${wa}" style="display:inline-block;background:#111;color:#ffffff;font-size:14px;font-weight:700;padding:12px 20px;border-radius:10px;text-decoration:none;">Share on WhatsApp</a>
          <span style="display:inline-block;margin-left:10px;font-size:13px;color:#555;">or copy the link and text it to your mates</span>
        </td></tr></table>
      </td></tr>
      <tr><td style="padding:12px 28px 30px;">
        <p style="margin:0 0 16px;font-size:14px;line-height:1.55;color:#555;">Can't wait to win one? <a href="${BOOK_URL}" style="color:#111;font-weight:700;">Book a detail now</a> and you're still in the draw.</p>
        <p style="margin:0;font-size:12px;line-height:1.6;color:#888;">Clean Car Collective, 8 Ebor Street, Te Aro, Wellington. You're getting this because you entered the giveaway at cleancarcollective.co.nz/giveaway.<br />Don't want giveaway updates? <a href="{{{ pm:unsubscribe }}}" style="color:#888;">Unsubscribe</a>.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
  return { subject, text, html };
}
