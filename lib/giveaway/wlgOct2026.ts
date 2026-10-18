/**
 * Wellington October 2026 giveaway: config + pure helpers shared by the
 * public entry endpoint, the admin draw endpoint and the /giveaway page.
 * Kept out of the route files because Next.js only allows HTTP handler
 * exports there.
 */

export const GIVEAWAY = {
  key: "wlg-oct-2026",
  shopSlug: "wellington",
  opens: new Date("2026-10-19T00:00:00+13:00"),
  closes: new Date("2026-10-29T23:59:59+13:00"),
  leadSource: "giveaway",
  leadSourceDetail: "WLG Oct 2026 giveaway entry",
};


/**
 * Machine-readable entry record kept in leads.internal_notes as a single
 * tagged line, since leads has no JSON column. Staff notes added later are
 * appended on new lines and never disturb it.
 */
export type EntryTag = { email_key: string; mobile_key: string; test: boolean; prize?: string; draw_id?: string };
const TAG_PREFIX = `[giveaway:${GIVEAWAY.key}]`;
export function buildEntryTag(t: EntryTag): string {
  return `${TAG_PREFIX} ${JSON.stringify(t)}`;
}
export function parseEntryTag(internalNotes: string | null | undefined): EntryTag | null {
  if (!internalNotes) return null;
  const line = internalNotes.split("\n").find((l) => l.startsWith(TAG_PREFIX));
  if (!line) return null;
  try { return JSON.parse(line.slice(TAG_PREFIX.length).trim()) as EntryTag; } catch { return null; }
}
export function replaceEntryTag(internalNotes: string | null | undefined, t: EntryTag): string {
  const lines = (internalNotes ?? "").split("\n").filter((l) => !l.startsWith(TAG_PREFIX));
  return [buildEntryTag(t), ...lines].join("\n").trim();
}


/** Trim, cap, and neutralise a leading = + - @ so exports can't be weaponised. */
export function clean(v: unknown, max: number): string {
  const s = String(v ?? "").trim().slice(0, max);
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
}
export function normaliseEmail(email: string): string {
  const e = email.toLowerCase().trim();
  const [localRaw = "", domainRaw = ""] = e.split("@");
  let local = localRaw.split("+")[0];
  let domain = domainRaw;
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replace(/\./g, "");
    domain = "gmail.com";
  }
  return `${local}@${domain}`;
}
export function normaliseMobile(mobile: string): string {
  let m = String(mobile).replace(/[^\d+]/g, "");
  if (m.startsWith("+64")) m = "0" + m.slice(3);
  else if (m.startsWith("0064")) m = "0" + m.slice(4);
  else if (m.startsWith("64") && m.length >= 10) m = "0" + m.slice(2);
  return m.replace(/\D/g, "");
}
