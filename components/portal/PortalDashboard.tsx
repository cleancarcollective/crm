"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type { PortalBooking, PortalReminder, PortalSnapshot, PortalVehicle } from "@/lib/portal/data";

const BOOKING_URLS: Record<string, string> = {
  wellington: "https://cleancarcollective.co.nz/make-a-booking/",
  christchurch: "https://cleancarcollective.co.nz/christchurch-make-a-booking/",
};

const CADENCES = [1, 2, 3, 6];

function fmtDate(iso: string, timezone: string) {
  return new Date(iso).toLocaleString("en-NZ", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtTime(iso: string, timezone: string) {
  return new Date(iso).toLocaleString("en-NZ", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function vehicleLabel(v: PortalVehicle) {
  const label = [v.year, v.make, v.model].filter(Boolean).join(" ");
  return label || v.rego || "Vehicle";
}

function fmtNzd(cents: number) {
  return new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(cents / 100);
}

export function PortalDashboard({ snapshot }: { snapshot: PortalSnapshot }) {
  const router = useRouter();
  const shopById = useMemo(
    () => new Map(snapshot.shops.map((s) => [s.id, s])),
    [snapshot.shops]
  );
  const vehicleById = useMemo(
    () => new Map(snapshot.vehicles.map((v) => [v.id, v])),
    [snapshot.vehicles]
  );

  const totalCreditCents = Object.values(snapshot.creditByShop).reduce((a, b) => a + b, 0);
  // Home shop (most recent booking's shop) decides which city's booking
  // form every CTA points at.
  const bookUrl = BOOKING_URLS[snapshot.primaryShopSlug] ?? BOOKING_URLS.wellington;

  return (
    <main className="portalShell">
      {/* Header */}
      <header className="portalHeader">
        <div>
          <p className="portalEyebrow">Clean Car Collective</p>
          <h1 className="portalTitle">
            {snapshot.firstName ? `Hey ${snapshot.firstName}` : "Your account"}
          </h1>
          <p className="portalSub">{snapshot.email}</p>
        </div>
        <div className="portalHeaderActions">
          <a href={bookUrl} className="portalPrimaryBtn portalPrimaryBtn--compact">+ Book a detail</a>
          <form action="/api/portal/auth/logout" method="post">
            <button type="submit" className="portalGhostBtn">Sign out</button>
          </form>
        </div>
      </header>

      {totalCreditCents > 0 ? (
        <section className="portalCreditBanner">
          <span className="portalCreditAmount">{fmtNzd(totalCreditCents)}</span>
          <span>
            credit on your account - mention it when booking and we&rsquo;ll apply it to
            your next detail.
          </span>
        </section>
      ) : null}

      {snapshot.stats.lifetimeDetails > 0 ? (
        <section className="portalStatsStrip">
          <div className="portalStat">
            <span className="portalStatValue">{snapshot.stats.lifetimeDetails}</span>
            <span className="portalStatLabel">detail{snapshot.stats.lifetimeDetails === 1 ? "" : "s"} with us</span>
          </div>
          <div className="portalStat">
            <span className="portalStatValue">{fmtNzd(snapshot.stats.lifetimeSpendCents)}</span>
            <span className="portalStatLabel">invested in your car{snapshot.vehicles.length === 1 ? "" : "s"}</span>
          </div>
          {snapshot.stats.memberBonusCents > 0 ? (
            <div className="portalStat portalStat--good">
              <span className="portalStatValue">{fmtNzd(snapshot.stats.memberBonusCents)}</span>
              <span className="portalStatLabel">earned in member bonus credit</span>
            </div>
          ) : null}
        </section>
      ) : null}

      <CollectiveSection snapshot={snapshot} onChanged={() => router.refresh()} />

      <WarrantySection snapshot={snapshot} vehicleById={vehicleById} />

      <BookingsSection snapshot={snapshot} shopById={shopById} vehicleById={vehicleById} onChanged={() => router.refresh()} />
      <RemindersSection snapshot={snapshot} shopById={shopById} onChanged={() => router.refresh()} />
      <PhotosSection snapshot={snapshot} shopById={shopById} />
      <GarageSection snapshot={snapshot} onChanged={() => router.refresh()} />
      <PastSection snapshot={snapshot} shopById={shopById} bookUrl={bookUrl} />
      <ProfileSection snapshot={snapshot} onChanged={() => router.refresh()} />
    </main>
  );
}

// ── Profile ────────────────────────────────────────────────────────────

function ProfileSection({ snapshot, onChanged }: { snapshot: PortalSnapshot; onChanged: () => void }) {
  const contact = snapshot.contacts[0];
  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState(contact?.first_name ?? "");
  const [lastName, setLastName] = useState(contact?.last_name ?? "");
  const [phone, setPhone] = useState(contact?.phone ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/portal/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ first_name: firstName, last_name: lastName, phone }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Could not save");
      }
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="portalSection">
      <div className="portalSectionHead">
        <h2 className="portalSectionTitle">Your details</h2>
        {!editing ? (
          <button type="button" className="portalLinkButton" onClick={() => setEditing(true)}>
            Edit
          </button>
        ) : null}
      </div>
      <div className="portalCard">
        {editing ? (
          <>
            <div className="portalFormGrid">
              <label className="portalField"><span>First name</span>
                <input className="portalInput" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </label>
              <label className="portalField"><span>Last name</span>
                <input className="portalInput" value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </label>
              <label className="portalField"><span>Phone</span>
                <input className="portalInput" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </label>
              <label className="portalField"><span>Email (your sign-in)</span>
                <input className="portalInput" value={snapshot.email} disabled />
              </label>
            </div>
            {error ? <p className="portalError">{error}</p> : null}
            <div className="portalCardActions">
              <button type="button" className="portalPrimaryBtn portalPrimaryBtn--compact" onClick={save} disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </button>
              <button type="button" className="portalLinkButton" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <h3 className="portalCardTitle">
              {[contact?.first_name, contact?.last_name].filter(Boolean).join(" ") || contact?.full_name || "-"}
            </h3>
            <p className="portalCardMeta">{[snapshot.email, contact?.phone].filter(Boolean).join(" · ")}</p>
          </>
        )}
      </div>
    </section>
  );
}

// ── Join the Collective ────────────────────────────────────────────────

const MEMBERSHIP_PRICING: Record<string, { fee: number; credit: number }> = {
  "Coupe / Hatchback": { fee: 108, credit: 125 },
  "Sedan / Wagon": { fee: 112, credit: 130 },
  "Small / Medium SUV": { fee: 117, credit: 135 },
  "Large SUV / Ute": { fee: 126, credit: 145 },
};

function CollectiveSection({ snapshot, onChanged }: { snapshot: PortalSnapshot; onChanged: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const membership = snapshot.memberships[0] ?? null;
  const totalBanked = Object.values(snapshot.creditByShop).reduce((a, b) => a + b, 0);

  // Their size tier: single vehicle's size, else the default mid tier.
  const sized = snapshot.vehicles.find((v) => v.size && MEMBERSHIP_PRICING[v.size]);
  const tier = sized?.size && snapshot.vehicles.length >= 1 ? sized.size : "Sedan / Wagon";
  const pricing = MEMBERSHIP_PRICING[tier] ?? MEMBERSHIP_PRICING["Sedan / Wagon"];

  async function join() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/portal/membership/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: snapshot.email, size_tier: tier, source: "portal" }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; checkout_url?: string | null; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Could not sign you up");
      if (data.checkout_url) {
        window.location.href = data.checkout_url;
        return;
      }
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign you up");
    } finally {
      setPending(false);
    }
  }

  async function openBilling() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/portal/membership/billing", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? "Couldn't open billing settings");
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open billing settings");
      setPending(false);
    }
  }

  if (membership) {
    return (
      <section className="portalSection">
        <div className="portalCard portalCollectiveCard">
          <div className="portalCardTop">
            <div>
              <p className="portalEyebrow" style={{ marginBottom: 2 }}>The Collective</p>
              <h2 className="portalCardTitle" style={{ fontSize: 17 }}>
                {membership.status === "active"
                  ? `Member - $${(membership.monthly_credit_cents / 100).toFixed(0)} credit lands monthly`
                  : membership.status === "past_due"
                    ? "Payment issue - credit paused"
                    : "One step left - set up your monthly payment"}
              </h2>
              <p className="portalCardMeta">
                ${(membership.monthly_fee_cents / 100).toFixed(0)}/mo +GST · {membership.size_tier} ·
                credit stacks month to month - spend it on anything
              </p>
              {membership.status === "active" && totalBanked > 0 ? (
                <p className="portalCardMeta" style={{ marginTop: 4, fontWeight: 600, color: "var(--success)" }}>
                  You&rsquo;ve banked ${(totalBanked / 100).toFixed(0)} - it&rsquo;s yours whenever you&rsquo;re ready.
                </p>
              ) : null}
              {membership.status === "past_due" ? (
                <p className="portalCardMeta" style={{ marginTop: 4 }}>
                  Your banked credit is safe - fix the payment and it keeps building.
                </p>
              ) : null}
            </div>
            <span className={`portalBadge ${membership.status === "active" ? "portalBadge--confirmed" : "portalBadge--pending"}`}>
              {membership.status.replace("_", " ")}
            </span>
          </div>
          {error ? <p className="portalError">{error}</p> : null}
          <div className="portalCardActions">
            {membership.status === "pending" ? (
              <button type="button" className="portalPrimaryBtn portalPrimaryBtn--compact" onClick={join} disabled={pending}>
                {pending ? "Opening…" : "Complete setup - 2 min"}
              </button>
            ) : (
              <button type="button" className="portalGhostBtn" onClick={openBilling} disabled={pending}>
                {pending ? "Opening…" : "Manage billing"}
              </button>
            )}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="portalSection">
      <div className="portalCard portalCollectiveCard">
        <p className="portalEyebrow" style={{ marginBottom: 2 }}>The Collective</p>
        <h2 className="portalCardTitle" style={{ fontSize: 18 }}>Detailing credit that builds every month</h2>
        <p className="portalCardMeta" style={{ marginBottom: 10 }}>
          <strong>${pricing.credit}/mo of detailing credit</strong> for ${pricing.fee}/mo +GST -
          ${pricing.credit - pricing.fee} of bonus value every month (15%+).
        </p>
        <ul className="portalPerkList">
          <li>Get busy? Credit stacks - bank a quiet month and put it toward a bigger detail</li>
          <li>Free mobile service + valet pickup &amp; drop-off (members only)</li>
          <li>Priority booking - first pick of the calendar + extended hours</li>
          <li>Pro photos of every detail, right here in your account</li>
        </ul>
        {error ? <p className="portalError">{error}</p> : null}
        <div className="portalCardActions">
          <button type="button" className="portalPrimaryBtn portalPrimaryBtn--compact" onClick={join} disabled={pending}>
            {pending ? "Signing you up…" : "Join the Collective"}
          </button>
          <span className="portalCardMeta">No lock-in · cancel anytime · banked credit stays yours</span>
        </div>
      </div>
    </section>
  );
}

// ── Ceramic warranties ─────────────────────────────────────────────────

const TIER_LABEL: Record<string, string> = {
  bronze: "Bronze · 1 year",
  silver: "Silver · 3 years",
  gold: "Gold · 5 years",
  unknown: "Term to be confirmed",
};

function WarrantySection({
  snapshot,
  vehicleById,
}: {
  snapshot: PortalSnapshot;
  vehicleById: Map<string, PortalVehicle>;
}) {
  if (snapshot.warranties.length === 0) return null;
  const bookUrl = BOOKING_URLS[snapshot.primaryShopSlug] ?? BOOKING_URLS.wellington;

  // Is a maintenance-wash-ish booking already on the calendar?
  const upcomingWash = snapshot.upcomingBookings.find((b) =>
    /wash|exterior|deluxe|maintenance/i.test(b.service_name)
  );

  return (
    <section className="portalSection">
      <h2 className="portalSectionTitle">Ceramic coating warranty</h2>
      <p className="portalSectionSub">
        A maintenance wash every 6 months keeps the coating performing and your warranty valid.
      </p>
      <div className="portalCardList">
        {snapshot.warranties.map((w) => {
          const vehicle = w.vehicle_id ? vehicleById.get(w.vehicle_id) : undefined;
          const applied = new Date(w.applied_at);
          const expires = w.expires_at ? new Date(w.expires_at) : null;
          const active = w.status === "active";
          const washesLeft = Math.max(0, w.washes_included - w.washes_used);
          const nextWash = w.next_wash_due_at ? new Date(w.next_wash_due_at) : null;

          // Warranty progress: elapsed vs term.
          let pct: number | null = null;
          if (expires) {
            const total = expires.getTime() - applied.getTime();
            pct = Math.round(Math.max(0, Math.min(1, (expires.getTime() - Date.now()) / total)) * 1000) / 1000;
          }

          return (
            <div key={w.id} className="portalCard">
              <div className="portalCardTop">
                <div>
                  <h3 className="portalCardTitle">
                    {TIER_LABEL[w.tier]} {vehicle ? `· ${vehicleLabel(vehicle)}` : ""}
                  </h3>
                  <p className="portalCardMeta">
                    Applied {applied.toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" })}
                    {expires
                      ? ` · valid until ${expires.toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" })}`
                      : " · term being confirmed by the team"}
                  </p>
                </div>
                <span className={`portalBadge ${active ? "portalBadge--confirmed" : ""}`}>
                  {active ? "active" : w.status}
                </span>
              </div>

              {pct !== null && active ? (
                <div className="portalProtection">
                  <div className="portalProtectionTop">
                    <span>Warranty</span>
                    <span>{Math.round(pct * 100)}% remaining</span>
                  </div>
                  <div className="portalProtectionTrack">
                    <div
                      className={`portalProtectionFill${pct <= 0.2 ? " portalProtectionFill--low" : ""}`}
                      style={{ width: `${Math.max(3, pct * 100)}%` }}
                    />
                  </div>
                </div>
              ) : null}

              {active ? (
                <div className="portalWarrantyMeta">
                  <span>
                    <strong>{washesLeft}</strong> of {w.washes_included} free maintenance washes left
                  </span>
                  {nextWash ? (
                    upcomingWash ? (
                      <span className="portalWarrantyOk">
                        ✓ Wash booked for {new Date(upcomingWash.scheduled_start).toLocaleDateString("en-NZ", { day: "numeric", month: "short" })}
                      </span>
                    ) : (
                      <span>
                        Next wash due {nextWash.toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" })} ·{" "}
                        <a href={bookUrl} className="portalLinkButton">book it →</a>
                      </span>
                    )
                  ) : null}
                </div>
              ) : (
                <p className="portalCardMeta" style={{ marginTop: 8 }}>
                  This warranty has ended. A fresh coating restarts full protection ·{" "}
                  <a href={bookUrl} className="portalLinkButton">talk to us →</a>
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Bookings ───────────────────────────────────────────────────────────

function BookingsSection({
  snapshot,
  shopById,
  vehicleById,
  onChanged,
}: {
  snapshot: PortalSnapshot;
  shopById: Map<string, PortalSnapshot["shops"][number]>;
  vehicleById: Map<string, PortalVehicle>;
  onChanged: () => void;
}) {
  return (
    <section className="portalSection">
      <h2 className="portalSectionTitle">Upcoming bookings</h2>
      {snapshot.upcomingBookings.length === 0 ? (
        <div className="portalEmpty">
          <p>No upcoming bookings.</p>
          <p className="portalEmptySub">Your car misses you - set a reminder below or book now.</p>
        </div>
      ) : (
        <div className="portalCardList">
          {snapshot.upcomingBookings.map((b) => (
            <BookingCard
              key={b.id}
              booking={b}
              shop={shopById.get(b.shop_id)}
              vehicle={b.vehicle_id ? vehicleById.get(b.vehicle_id) : undefined}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function BookingCard({
  booking,
  shop,
  vehicle,
  onChanged,
}: {
  booking: PortalBooking;
  shop?: PortalSnapshot["shops"][number];
  vehicle?: PortalVehicle;
  onChanged: () => void;
}) {
  const tz = shop?.timezone ?? "Pacific/Auckland";
  const [mode, setMode] = useState<"idle" | "reschedule" | "cancel" | "done">(
    booking.notes?.includes("[Reschedule requested]") || booking.notes?.includes("[Cancel requested]")
      ? "done"
      : "idle"
  );
  const [preferred, setPreferred] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(kind: "reschedule" | "cancel") {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/bookings/${booking.id}/request-change`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, preferred, note }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Could not send request");
      }
      setMode("done");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send request");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="portalCard">
      <div className="portalCardTop">
        <div>
          <h3 className="portalCardTitle">{booking.service_name}</h3>
          <p className="portalCardMeta">
            {fmtDate(booking.scheduled_start, tz)} · {fmtTime(booking.scheduled_start, tz)}
            {shop ? ` · ${shop.name.replace("Clean Car Collective ", "")}` : ""}
            {booking.location_type === "mobile" ? " · Mobile" : ""}
          </p>
          {vehicle ? <p className="portalCardMeta">{vehicleLabel(vehicle)}</p> : null}
        </div>
        <span className={`portalBadge portalBadge--${booking.status}`}>{booking.status.replaceAll("_", " ")}</span>
      </div>

      {mode === "done" ? (
        <p className="portalCardNote">✓ Change request sent - the team will confirm by email.</p>
      ) : mode === "idle" ? (
        <div className="portalCardActions">
          <button type="button" className="portalGhostBtn" onClick={() => setMode("reschedule")}>
            Reschedule
          </button>
          <button
            type="button"
            className="portalGhostBtn portalGhostBtn--danger"
            onClick={() => setMode("cancel")}
          >
            Cancel booking
          </button>
        </div>
      ) : (
        <div className="portalChangeForm">
          {mode === "reschedule" ? (
            <label className="portalField">
              <span>Preferred new day / time</span>
              <input
                type="text"
                className="portalInput"
                value={preferred}
                onChange={(e) => setPreferred(e.target.value)}
                placeholder="e.g. any morning next week"
              />
            </label>
          ) : null}
          <label className="portalField">
            <span>{mode === "cancel" ? "Reason (optional)" : "Anything else? (optional)"}</span>
            <input
              type="text"
              className="portalInput"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={mode === "cancel" ? "Helps us improve" : ""}
            />
          </label>
          {error ? <p className="portalError">{error}</p> : null}
          <div className="portalCardActions">
            <button
              type="button"
              className={mode === "cancel" ? "portalDangerBtn" : "portalPrimaryBtn portalPrimaryBtn--compact"}
              onClick={() => submit(mode)}
              disabled={pending}
            >
              {pending ? "Sending…" : mode === "cancel" ? "Request cancellation" : "Send reschedule request"}
            </button>
            <button type="button" className="portalLinkButton" onClick={() => setMode("idle")}>
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Reminders ──────────────────────────────────────────────────────────

function RemindersSection({
  snapshot,
  shopById,
  onChanged,
}: {
  snapshot: PortalSnapshot;
  shopById: Map<string, PortalSnapshot["shops"][number]>;
  onChanged: () => void;
}) {
  // Collapsed by default - the Collective membership is the primary
  // path; free reminders are the soft fallback.
  const [adding, setAdding] = useState(false);
  const [cadence, setCadence] = useState(3);
  const [vehicleId, setVehicleId] = useState<string>("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/portal/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cadence_months: cadence,
          vehicle_id: vehicleId || undefined,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Could not save reminder");
      }
      setAdding(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save reminder");
    } finally {
      setPending(false);
    }
  }

  async function patch(id: string, action: string) {
    await fetch("/api/portal/reminders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action }),
    });
    onChanged();
  }

  return (
    <section className="portalSection">
      <div className="portalSectionHead">
        <h2 className="portalSectionTitle">Free reminders</h2>
        {!adding ? (
          <button type="button" className="portalLinkButton" onClick={() => setAdding(true)}>
            + Add reminder
          </button>
        ) : null}
      </div>
      <p className="portalSectionSub">
        Not ready to lock in a slot? We&rsquo;ll email you when the car&rsquo;s due - a week early,
        so you get first pick of the calendar.
      </p>

      {snapshot.reminders.length > 0 ? (
        <div className="portalCardList">
          {snapshot.reminders.map((r: PortalReminder) => {
            const shop = shopById.get(r.shop_id);
            const vehicle = snapshot.vehicles.find((v) => v.id === r.vehicle_id);
            return (
              <div key={r.id} className="portalCard portalCard--row">
                <div>
                  <h3 className="portalCardTitle">
                    Every {r.cadence_months} month{r.cadence_months === 1 ? "" : "s"}
                    {vehicle ? ` · ${vehicleLabel(vehicle)}` : ""}
                  </h3>
                  <p className="portalCardMeta">
                    Next due:{" "}
                    {new Date(r.next_due_at).toLocaleDateString("en-NZ", {
                      timeZone: shop?.timezone ?? "Pacific/Auckland",
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                    {" · priority booking opens "}
                    {new Date(new Date(r.next_due_at).getTime() - 7 * 86400000).toLocaleDateString("en-NZ", {
                      timeZone: shop?.timezone ?? "Pacific/Auckland",
                      day: "numeric",
                      month: "short",
                    })}
                    {r.status === "paused" ? " · paused" : ""}
                  </p>
                </div>
                <div className="portalCardActions">
                  {r.status === "paused" ? (
                    <button type="button" className="portalGhostBtn" onClick={() => patch(r.id, "resume")}>
                      Resume
                    </button>
                  ) : (
                    <button type="button" className="portalGhostBtn" onClick={() => patch(r.id, "pause")}>
                      Pause
                    </button>
                  )}
                  <button
                    type="button"
                    className="portalGhostBtn portalGhostBtn--danger"
                    onClick={() => patch(r.id, "cancel")}
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {adding ? (
        <div className="portalCard portalReminderForm">
          <p className="portalFieldLabel">Remind me every…</p>
          <div className="portalChipRow">
            {CADENCES.map((m) => (
              <button
                key={m}
                type="button"
                className={`portalChip${cadence === m ? " portalChip--active" : ""}`}
                onClick={() => setCadence(m)}
              >
                {m} month{m === 1 ? "" : "s"}
              </button>
            ))}
          </div>
          {snapshot.vehicles.length > 0 ? (
            <label className="portalField">
              <span>For which vehicle?</span>
              <select
                className="portalInput"
                value={vehicleId}
                onChange={(e) => setVehicleId(e.target.value)}
              >
                <option value="">Any / all vehicles</option>
                {snapshot.vehicles.map((v) => (
                  <option key={v.id} value={v.id}>{vehicleLabel(v)}</option>
                ))}
              </select>
            </label>
          ) : null}
          {error ? <p className="portalError">{error}</p> : null}
          <div className="portalCardActions">
            <button type="button" className="portalPrimaryBtn portalPrimaryBtn--compact" onClick={create} disabled={pending}>
              {pending ? "Saving…" : "Set reminder"}
            </button>
            {snapshot.reminders.length > 0 ? (
              <button type="button" className="portalLinkButton" onClick={() => setAdding(false)}>
                Cancel
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

// ── Photos ─────────────────────────────────────────────────────────────

function PhotosSection({
  snapshot,
  shopById,
}: {
  snapshot: PortalSnapshot;
  shopById: Map<string, PortalSnapshot["shops"][number]>;
}) {
  if (snapshot.photos.length === 0) return null;

  // Group by booking, labelled with the booking's service + date when
  // we have it in the snapshot.
  const allBookings = [...snapshot.upcomingBookings, ...snapshot.pastBookings];
  const groups = new Map<string, typeof snapshot.photos>();
  for (const p of snapshot.photos) {
    const arr = groups.get(p.booking_id) ?? [];
    arr.push(p);
    groups.set(p.booking_id, arr);
  }

  return (
    <section className="portalSection">
      <h2 className="portalSectionTitle">Your detail photos</h2>
      <p className="portalSectionSub">Before and after shots from the team while working on your car.</p>
      <div className="portalCardList">
        {[...groups.entries()].map(([bookingId, photos]) => {
          const booking = allBookings.find((b) => b.id === bookingId);
          const tz = booking ? shopById.get(booking.shop_id)?.timezone ?? "Pacific/Auckland" : "Pacific/Auckland";
          const label = booking
            ? `${booking.service_name} · ${new Date(booking.scheduled_start).toLocaleDateString("en-NZ", { timeZone: tz, day: "numeric", month: "short", year: "numeric" })}`
            : new Date(photos[0].created_at).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" });
          return (
            <div key={bookingId} className="portalCard">
              <h3 className="portalCardTitle" style={{ marginBottom: 10 }}>{label}</h3>
              <div className={photos.some((p) => p.kind === "pair") ? "portalPhotoGrid portalPhotoGrid--pairs" : "portalPhotoGrid"}>
                {photos.map((p) => (
                  <a key={p.id} href={p.public_url} target="_blank" rel="noopener noreferrer" className="portalPhotoItem">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.public_url} alt={p.label ?? "Detail photo"} loading="lazy" className={p.kind === "pair" ? "portalPhotoWide" : undefined} />
                    {p.label ? <span className="portalPhotoLabel">{p.label}</span> : null}
                  </a>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Garage ─────────────────────────────────────────────────────────────

// Protection heuristic from the vehicle's most recent service: what was
// applied and how long it lasts.
function protectionFor(
  vehicleId: string,
  bookings: PortalBooking[]
): { label: string; appliedAt: string; months: number } | null {
  const past = bookings
    .filter((b) => b.vehicle_id === vehicleId && new Date(b.scheduled_start).getTime() < Date.now())
    .sort((a, b) => b.scheduled_start.localeCompare(a.scheduled_start));
  for (const b of past) {
    const s = b.service_name.toLowerCase();
    if (s.includes("ceramic")) {
      const months = s.includes("gold") ? 60 : s.includes("silver") ? 36 : 12;
      return { label: "Ceramic coating", appliedAt: b.scheduled_start, months };
    }
    if (s.includes("premium detail") || s.includes("6 month")) {
      return { label: "Paint sealant", appliedAt: b.scheduled_start, months: 6 };
    }
    if (s.includes("deluxe detail") || s.includes("exterior")) {
      return { label: "Paint sealant", appliedAt: b.scheduled_start, months: 3 };
    }
  }
  return null;
}

function ProtectionBar({ vehicleId, snapshot, bookUrl }: { vehicleId: string; snapshot: PortalSnapshot; bookUrl: string }) {
  const all = [...snapshot.upcomingBookings, ...snapshot.pastBookings];
  const prot = protectionFor(vehicleId, all);
  if (!prot) return null;

  const start = new Date(prot.appliedAt).getTime();
  const end = new Date(prot.appliedAt);
  end.setMonth(end.getMonth() + prot.months);
  const total = end.getTime() - start;
  const remaining = end.getTime() - Date.now();
  // Rounded to 0.1% so SSR + client hydration render identical widths
  // (raw Date.now() float widths mismatch by microseconds).
  const pct = Math.round(Math.max(0, Math.min(1, remaining / total)) * 1000) / 1000;
  const weeksLeft = Math.round(remaining / (7 * 86400000));

  return (
    <div className="portalProtection">
      <div className="portalProtectionTop">
        <span>{prot.label}</span>
        <span className={pct <= 0 ? "portalProtectionExpired" : undefined}>
          {pct <= 0 ? (
            <a href={bookUrl} style={{ color: "inherit" }}>expired - book a top-up →</a>
          ) : weeksLeft > 8 ? (
            `${Math.round(weeksLeft / 4.345)} months left`
          ) : (
            `${weeksLeft} week${weeksLeft === 1 ? "" : "s"} left`
          )}
        </span>
      </div>
      <div className="portalProtectionTrack">
        <div
          className={`portalProtectionFill${pct <= 0.2 ? " portalProtectionFill--low" : ""}`}
          style={{ width: `${Math.max(3, pct * 100)}%` }}
        />
      </div>
    </div>
  );
}

function GarageSection({ snapshot, onChanged }: { snapshot: PortalSnapshot; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [rego, setRego] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/portal/vehicles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ make, model, year, rego }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Could not save vehicle");
      }
      setMake(""); setModel(""); setYear(""); setRego("");
      setAdding(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save vehicle");
    } finally {
      setPending(false);
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/portal/vehicles?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      alert(data.error ?? "Could not remove vehicle");
      return;
    }
    onChanged();
  }

  return (
    <section className="portalSection">
      <div className="portalSectionHead">
        <h2 className="portalSectionTitle">Garage</h2>
        {!adding ? (
          <button type="button" className="portalLinkButton" onClick={() => setAdding(true)}>
            + Add vehicle
          </button>
        ) : null}
      </div>

      {snapshot.vehicles.length === 0 && !adding ? (
        <div className="portalEmpty">
          <p>No vehicles saved yet.</p>
          <p className="portalEmptySub">Add your car so booking takes seconds.</p>
        </div>
      ) : (
        <div className="portalGarageGrid">
          {snapshot.vehicles.map((v) => (
            <div key={v.id} className="portalCard">
              <div className="portalCardTop">
                <div>
                  <h3 className="portalCardTitle">{vehicleLabel(v)}</h3>
                  <p className="portalCardMeta">
                    {[v.rego, v.size].filter(Boolean).join(" · ") || "-"}
                  </p>
                </div>
                <button
                  type="button"
                  className="portalGhostBtn portalGhostBtn--danger"
                  onClick={() => remove(v.id)}
                >
                  Remove
                </button>
              </div>
              <ProtectionBar
                vehicleId={v.id}
                snapshot={snapshot}
                bookUrl={BOOKING_URLS[snapshot.primaryShopSlug] ?? BOOKING_URLS.wellington}
              />
            </div>
          ))}
        </div>
      )}

      {adding ? (
        <div className="portalCard portalReminderForm">
          <div className="portalFormGrid">
            <label className="portalField"><span>Make</span>
              <input className="portalInput" value={make} onChange={(e) => setMake(e.target.value)} placeholder="Toyota" />
            </label>
            <label className="portalField"><span>Model</span>
              <input className="portalInput" value={model} onChange={(e) => setModel(e.target.value)} placeholder="Hilux" />
            </label>
            <label className="portalField"><span>Year</span>
              <input className="portalInput" value={year} onChange={(e) => setYear(e.target.value)} placeholder="2021" />
            </label>
            <label className="portalField"><span>Rego</span>
              <input className="portalInput" value={rego} onChange={(e) => setRego(e.target.value)} placeholder="ABC123" />
            </label>
          </div>
          {error ? <p className="portalError">{error}</p> : null}
          <div className="portalCardActions">
            <button type="button" className="portalPrimaryBtn portalPrimaryBtn--compact" onClick={add} disabled={pending}>
              {pending ? "Saving…" : "Add vehicle"}
            </button>
            <button type="button" className="portalLinkButton" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

// ── Past bookings ──────────────────────────────────────────────────────

function PastSection({
  snapshot,
  shopById,
  bookUrl,
}: {
  snapshot: PortalSnapshot;
  shopById: Map<string, PortalSnapshot["shops"][number]>;
  bookUrl: string;
}) {
  if (snapshot.pastBookings.length === 0) return null;
  return (
    <section className="portalSection">
      <h2 className="portalSectionTitle">History</h2>
      <div className="portalHistoryList">
        {snapshot.pastBookings.map((b) => {
          const tz = shopById.get(b.shop_id)?.timezone ?? "Pacific/Auckland";
          return (
            <div key={b.id} className="portalHistoryRow">
              <span className="portalHistoryDate">
                {new Date(b.scheduled_start).toLocaleDateString("en-NZ", {
                  timeZone: tz,
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </span>
              <span className="portalHistoryService">{b.service_name}</span>
              <a href={bookUrl} className="portalLinkButton">Book again</a>
            </div>
          );
        })}
      </div>
    </section>
  );
}
