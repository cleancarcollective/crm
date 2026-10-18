/**
 * Giveaway entry confirmation. Its real job is to put the entrant's share
 * link somewhere they can find it again: most people close the success
 * screen and only share later, from their inbox.
 *
 * Sent after the entry response via next/server `after()`, so a slow SMTP
 * round trip never delays the form. Transactional (they just entered), so
 * no unsubscribe footer is needed.
 */

import { EMAIL_HEAD_HARDENING } from "@/lib/email/sharedEmailStyles";
import { getShopContactsById } from "@/lib/email/shopContacts";
import { sendViaGmailSmtp } from "@/lib/email/smtpClient";
import { shareUrlFor } from "@/lib/giveaway/wlgOct2026";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function sendGiveawayEntryEmail(args: { shopId: string; to: string; firstName: string; code: string; test: boolean }) {
  const contacts = await getShopContactsById(args.shopId);
  const url = shareUrlFor(args.code);
  const shareText = `I just entered Clean Car Collective's Wellington giveaway to win a Premium Detail + $100 cash. Free to enter, takes 30 seconds, and if you win the grand prize I win one too: ${url}`;
  const waLink = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
  const first = escapeHtml(args.firstName);
  const subject = `${args.test ? "[TEST] " : ""}You're in the draw. Here's your link for extra entries`;

  const TextBody = [
    `Hi ${args.firstName},`,
    ``,
    `Your entry for the Wellington giveaway is in. Winners are drawn on Friday 30 October and we'll email or call you if you win.`,
    ``,
    `Want more chances to win? Share your link:`,
    url,
    ``,
    `Every friend who enters with your link gives you an extra entry in the draw. If a friend you referred wins the grand prize, you win one too.`,
    ``,
    `Can't wait to win one? Book a detail now and you're still in the draw: https://cleancarcollective.co.nz/make-a-booking/`,
    ``,
    `Clean Car Collective`,
    `8 Ebor Street, Te Aro, Wellington`,
  ].join("\n");

  const HtmlBody = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(subject)}</title>
    ${EMAIL_HEAD_HARDENING}
  </head>
  <body style="margin:0;padding:0;background:#E5E4E2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#E5E4E2;padding:28px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;">
          <tr><td style="background:#000000;padding:22px 28px;color:#ffffff;font-size:13px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;">Clean Car Collective</td></tr>
          <tr><td style="padding:30px 28px 8px;">
            <p style="margin:0 0 14px;font-size:22px;font-weight:800;color:#111;">You're in, ${first}!</p>
            <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#333;">Your entry for the Wellington giveaway is locked in. Winners are drawn on <strong>Friday 30 October</strong> and we'll email or call you if you win.</p>
          </td></tr>
          <tr><td style="padding:8px 28px 10px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fffbe6;border:2px solid #f7e04a;border-radius:14px;">
              <tr><td style="padding:22px 22px 20px;">
                <p style="margin:0 0 6px;font-size:11px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:#111;">Want more chances to win?</p>
                <p style="margin:0 0 12px;font-size:17px;font-weight:800;line-height:1.3;color:#111;">Share your link. Every friend who enters = 1 extra entry for you.</p>
                <p style="margin:0 0 14px;font-size:14px;line-height:1.5;color:#444;">And if a friend you referred wins the grand prize, you win one too.</p>
                <p style="margin:0 0 16px;padding:12px 14px;background:#ffffff;border:1px solid #e6dca6;border-radius:10px;font-size:14px;word-break:break-all;"><a href="${url}" style="color:#111;font-weight:600;text-decoration:none;">${url}</a></p>
                <a href="${waLink}" style="display:inline-block;background:#111;color:#ffffff;font-size:14px;font-weight:700;padding:12px 20px;border-radius:10px;text-decoration:none;">Share on WhatsApp</a>
                <span style="display:inline-block;margin-left:10px;font-size:13px;color:#555;">or copy the link and text it to your mates</span>
              </td></tr>
            </table>
          </td></tr>
          <tr><td style="padding:12px 28px 30px;">
            <p style="margin:0 0 16px;font-size:14px;line-height:1.55;color:#555;">Can't wait to win one? <a href="https://cleancarcollective.co.nz/make-a-booking/" style="color:#111;font-weight:700;">Book a detail now</a> and you're still in the draw.</p>
            <p style="margin:0;font-size:12px;line-height:1.5;color:#888;">Clean Car Collective, 8 Ebor Street, Te Aro, Wellington. You're getting this because you entered the giveaway at cleancarcollective.co.nz/giveaway.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  await sendViaGmailSmtp({
    From: contacts.from_line,
    To: args.to,
    Subject: subject,
    TextBody,
    HtmlBody,
    Metadata: { kind: "giveaway_entry", code: args.code },
  });
}
