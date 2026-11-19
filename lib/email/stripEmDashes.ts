/**
 * Kill em dashes (and their unicode cousins) from every outbound email.
 *
 * Applied at the two send boundaries — Gmail SMTP (customer email) and the
 * Postmark client (staff notifications) — so it catches every message no
 * matter which sender built it, including AI-drafted copy. House rule:
 * Clean Car Collective email never contains an em dash.
 *
 * We replace em dash (U+2014), en dash (U+2013), figure dash (U+2012) and
 * horizontal bar (U+2015) with a spaced hyphen " - ", then tidy the spacing
 * so we don't leave double spaces or a space before punctuation.
 */
const DASH_RE = /\s*[‒–—―]\s*/g;

export function stripEmDashes(value: string | null | undefined): string | null | undefined {
  if (value == null) return value;
  return value
    .replace(DASH_RE, " - ")
    .replace(/ {2,}/g, " ")
    .replace(/ +([,.!?;:])/g, "$1");
}

/** Sanitize the em-dash-bearing fields of an outbound email in place-safe form. */
export function sanitizeEmailFields<
  T extends { Subject?: string; TextBody?: string; HtmlBody?: string }
>(args: T): T {
  return {
    ...args,
    ...(args.Subject !== undefined ? { Subject: stripEmDashes(args.Subject) as string } : {}),
    ...(args.TextBody !== undefined ? { TextBody: stripEmDashes(args.TextBody) as string } : {}),
    ...(args.HtmlBody !== undefined ? { HtmlBody: stripEmDashes(args.HtmlBody) as string } : {}),
  };
}
