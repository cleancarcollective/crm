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
  const primaryShop = snapshot.shops[0];
  const bookUrl =
    BOOKING_URLS[primaryShop?.slug ?? "wellington"] ?? BOOKING_URLS.wellington;

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
            prepaid credit on your account — mention it when booking and we&rsquo;ll apply it to
            your next detail.
          </span>
        </section>
      ) : null}

      <BookingsSection snapshot={snapshot} shopById={shopById} vehicleById={vehicleById} onChanged={() => router.refresh()} />
      <RemindersSection snapshot={snapshot} shopById={shopById} onChanged={() => router.refresh()} />
      <GarageSection snapshot={snapshot} onChanged={() => router.refresh()} />
      <PastSection snapshot={snapshot} shopById={shopById} bookUrl={bookUrl} />
    </main>
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
          <p className="portalEmptySub">Your car misses you — set a reminder below or book now.</p>
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
        <p className="portalCardNote">✓ Change request sent — the team will confirm by email.</p>
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
  const [adding, setAdding] = useState(snapshot.reminders.length === 0);
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
        <h2 className="portalSectionTitle">Detail reminders</h2>
        {!adding ? (
          <button type="button" className="portalLinkButton" onClick={() => setAdding(true)}>
            + Add reminder
          </button>
        ) : null}
      </div>
      <p className="portalSectionSub">
        Never think about when the car&rsquo;s due again — pick a rhythm and we&rsquo;ll nudge you
        with priority booking when it&rsquo;s time.
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

// ── Garage ─────────────────────────────────────────────────────────────

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
            <div key={v.id} className="portalCard portalCard--row">
              <div>
                <h3 className="portalCardTitle">{vehicleLabel(v)}</h3>
                <p className="portalCardMeta">
                  {[v.rego, v.size].filter(Boolean).join(" · ") || "—"}
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
