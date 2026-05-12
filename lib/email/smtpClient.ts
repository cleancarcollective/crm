/**
 * Gmail SMTP relay client. Routes to the correct per-shop mailbox
 * (info@cleancarcollective.co.nz for Christchurch, hello@cleancarcollective.co.nz
 * for Wellington) by inspecting the From header.
 *
 * Why SMTP and not Postmark for customer-facing email:
 *   - Gmail SMTP sends use Google's own outbound infrastructure with
 *     SPF/DKIM/DMARC signing by Google, exactly like a manual send from
 *     gmail.com. Most of our customers ARE on Gmail so this maximises
 *     Primary-tab placement.
 *   - Postmark is retained for internal staff notifications where
 *     deliverability is to known team_email addresses and webhook
 *     event-tracking matters.
 *
 * Setup required (per mailbox):
 *   1. 2-Step Verification enabled on the Google Workspace account.
 *   2. Generate an App Password named "CRM SMTP".
 *   3. Set env vars in Vercel:
 *        GMAIL_APP_PASSWORD_CHRISTCHURCH=<16-char password for info@>
 *        GMAIL_APP_PASSWORD_WELLINGTON=<16-char password for hello@>
 *
 * Returns a Postmark-shaped { MessageID } so call sites don't have to
 * branch — the existing senders update email_messages.provider_message_id
 * with whatever's returned regardless of source.
 */

import nodemailer from "nodemailer";

import { getShopContactsById } from "@/lib/email/shopContacts";

type TransportCache = Map<string, nodemailer.Transporter>;
const transports: TransportCache = new Map();

function appPasswordFor(fromEmail: string): string | null {
  const lower = fromEmail.toLowerCase();
  // Christchurch customer-facing sender is ben@; info@ kept as a fallback
  // mapping in case anything still tries to send from the team mailbox.
  if (
    lower.includes("ben@cleancarcollective.co.nz") ||
    lower.includes("info@cleancarcollective.co.nz")
  ) {
    return process.env.GMAIL_APP_PASSWORD_CHRISTCHURCH ?? null;
  }
  if (lower.includes("hello@cleancarcollective.co.nz")) {
    return process.env.GMAIL_APP_PASSWORD_WELLINGTON ?? null;
  }
  return null;
}

/**
 * Extract the bare email from a possibly-display-named From line.
 * "Max <hello@cleancarcollective.co.nz>" → "hello@cleancarcollective.co.nz"
 */
function extractEmailAddress(fromLine: string): string {
  const m = fromLine.match(/<([^>]+)>/);
  return m ? m[1]! : fromLine.trim();
}

function getTransport(userEmail: string, password: string): nodemailer.Transporter {
  const cached = transports.get(userEmail);
  if (cached) return cached;
  const t = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: userEmail, pass: password },
  });
  transports.set(userEmail, t);
  return t;
}

export type SmtpSendArgs = {
  From: string;
  To: string;
  ReplyTo?: string;
  Subject: string;
  TextBody?: string;
  HtmlBody?: string;
  /** Carried through to a custom header so the message can be cross-referenced
   *  back to email_messages / leads / bookings if needed. */
  Metadata?: Record<string, string>;
};

export type SmtpSendResult = { MessageID: string };

export async function sendViaGmailSmtp(args: SmtpSendArgs): Promise<SmtpSendResult> {
  const fromEmail = extractEmailAddress(args.From);
  const password = appPasswordFor(fromEmail);
  if (!password) {
    throw new Error(`No Gmail app password configured for ${fromEmail}`);
  }
  const transport = getTransport(fromEmail, password);

  const headers: Record<string, string> = {};
  if (args.Metadata) {
    // Gmail SMTP can't store metadata server-side like Postmark does, so
    // we stash it in an X- header. Useful when debugging via the raw
    // Sent-folder copy in Gmail.
    for (const [k, v] of Object.entries(args.Metadata)) {
      headers[`X-CRM-${k.replace(/[^a-zA-Z0-9_-]/g, "-")}`] = v;
    }
  }

  const info = await transport.sendMail({
    from: args.From,
    to: args.To,
    replyTo: args.ReplyTo,
    subject: args.Subject,
    text: args.TextBody,
    html: args.HtmlBody,
    headers,
  });

  return { MessageID: info.messageId };
}

/**
 * Convenience: same call shape as Postmark's `sendEmail`, returning a
 * MessageID. Use this from senders that previously called
 * `postmark.sendEmail(...)` for customer-facing messages.
 *
 * If no Gmail app password is configured for the From address, throws —
 * we don't silently fall back to Postmark because that defeats the
 * deliverability fix. Set the env vars or override SEND_CUSTOMER_VIA at
 * the call site.
 */
export async function sendCustomerEmail(args: SmtpSendArgs & {
  /** Optional shop_id to resolve a default From if From is empty. */
  shopId?: string;
}): Promise<SmtpSendResult> {
  let from = args.From;
  if (!from && args.shopId) {
    const contacts = await getShopContactsById(args.shopId);
    from = contacts.from_line;
  }
  if (!from) throw new Error("sendCustomerEmail: From or shopId required");
  return sendViaGmailSmtp({ ...args, From: from });
}
