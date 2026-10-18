/**
 * Wellington October 2026 giveaway: config + pure helpers shared by the
 * public entry endpoint, the admin draw endpoint and the /giveaway page.
 * Kept out of the route files because Next.js only allows HTTP handler
 * exports there.
 */

import { randomBytes } from "node:crypto";

export const GIVEAWAY = {
  key: "wlg-oct-2026",
  shopSlug: "wellington",
  opens: new Date("2026-10-19T00:00:00+13:00"),
  closes: new Date("2026-10-29T23:59:59+13:00"),
  leadSource: "giveaway",
  leadSourceDetail: "WLG Oct 2026 giveaway entry",
};

/**
 * Referral mechanic. Every entrant gets a personal share link. Each friend
 * who enters through it adds one ticket to the referrer's name, and if the
 * grand prize winner came in through a link, the referrer wins a grand
 * prize too. Tickets, not entries: a person still only ever has one entry
 * row, the draw just weights it.
 */
export const REFERRAL = {
  shareUrlBase: "https://cleancarcollective.co.nz/giveaway/",
  codeLength: 8,
  /** Cap on referral tickets per person. High enough that no real sharer
   *  hits it, low enough that a fake-signup farm can't buy the draw. */
  maxExtraEntries: 50,
};


/**
 * Machine-readable entry record kept in leads.internal_notes as a single
 * tagged line, since leads has no JSON column. Staff notes added later are
 * appended on new lines and never disturb it.
 */
export type EntryTag = {
  email_key: string;
  mobile_key: string;
  test: boolean;
  /** This entrant's own referral code (share link is ?ref=code). */
  code?: string;
  /** Code of the entrant whose link they used. Validated when they entered. */
  ref?: string;
  /** Stamped by the draw: tickets this entry held when drawn. */
  tickets?: number;
  prize?: string;
  draw_id?: string;
};
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


/* ---- Referral codes ---- */

// 32 symbols with 0/O and 1/I left out so codes survive being read aloud.
// 256 % 32 === 0, so byte % 32 has no modulo bias.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function newReferralCode(): string {
  const bytes = randomBytes(REFERRAL.codeLength);
  let out = "";
  for (let i = 0; i < REFERRAL.codeLength; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

/** Uppercases and validates a code from a query string or form field. */
export function normaliseReferralCode(v: unknown): string | null {
  const s = String(v ?? "").trim().toUpperCase();
  if (s.length !== REFERRAL.codeLength) return null;
  for (const ch of s) if (!CODE_ALPHABET.includes(ch)) return null;
  return s;
}

export function shareUrlFor(code: string): string {
  return `${REFERRAL.shareUrlBase}?ref=${code}`;
}

/** Referral tickets earned per code, counting only the entries passed in. */
export function referralCounts(entries: Array<{ tag: EntryTag }>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of entries) if (e.tag.ref) counts.set(e.tag.ref, (counts.get(e.tag.ref) ?? 0) + 1);
  return counts;
}

export function ticketsFor(tag: EntryTag, counts: Map<string, number>): number {
  const refs = tag.code ? (counts.get(tag.code) ?? 0) : 0;
  return 1 + Math.min(refs, REFERRAL.maxExtraEntries);
}


/* ---- Weighted draw ---- */

/** Uniform float in [0, 1) from the CSPRNG so the draw isn't on Math.random. */
export function secureRandom(): number {
  return randomBytes(6).readUIntBE(0, 6) / 2 ** 48;
}

/** Pick one index from the pool, weighted by ticket count, and remove it. */
function weightedPick(pool: Map<number, number>, rng: () => number): number | null {
  let total = 0;
  for (const w of pool.values()) total += w;
  if (total <= 0) return null;
  let r = rng() * total;
  let last: number | null = null;
  for (const [i, w] of pool) {
    last = i;
    r -= w;
    if (r < 0) { pool.delete(i); return i; }
  }
  if (last !== null) pool.delete(last); // float rounding edge: fall back to the final entry
  return last;
}

export type DrawOutcome = { grand: number; bonus: number | null; runnersUp: number[]; reserves: number[] };

/**
 * Weighted random draw without replacement. `tickets[i]` is entry i's
 * ticket count and `referrerOf(i)` is the index of the entry whose link
 * entry i used (or null). The grand winner's referrer takes the bonus grand
 * prize and leaves the pool before runners-up are drawn, so nobody wins
 * twice.
 */
export function runDraw(opts: {
  tickets: number[];
  referrerOf: (i: number) => number | null;
  runnersUp: number;
  reserves: number;
  rng?: () => number;
}): DrawOutcome | null {
  const rng = opts.rng ?? secureRandom;
  const pool = new Map<number, number>(opts.tickets.map((t, i) => [i, Math.max(0, t)]));
  const grand = weightedPick(pool, rng);
  if (grand === null) return null;
  const ref = opts.referrerOf(grand);
  const bonus = ref !== null && pool.has(ref) ? ref : null;
  if (bonus !== null) pool.delete(bonus);
  const take = (n: number) => {
    const out: number[] = [];
    for (let k = 0; k < n; k++) {
      const p = weightedPick(pool, rng);
      if (p === null) break;
      out.push(p);
    }
    return out;
  };
  return { grand, bonus, runnersUp: take(opts.runnersUp), reserves: take(opts.reserves) };
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
