"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// ── Types ─────────────────────────────────────────────────────────────

type ContactResult = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  vehicles: VehicleResult[];
};

type VehicleResult = {
  id: string;
  make: string | null;
  model: string | null;
  year: string | null;
  rego: string | null;
  size: string | null;
};

type Props = {
  defaultDate?: string; // yyyy-MM-dd
  onClose: () => void;
};

// ── Helpers ───────────────────────────────────────────────────────────

function vehicleLabel(v: VehicleResult) {
  const parts = [v.year, v.make, v.model].filter(Boolean).join(" ");
  return parts ? (v.rego ? `${parts} (${v.rego})` : parts) : v.rego ?? "Unknown vehicle";
}

// ── Recurring helpers ──────────────────────────────────────────────────
// Mirror of describeMonthlyNthWeekday on the server. Kept inline so the
// modal stays a self-contained client component.
function describeMonthlyNthWeekdayLocal(date: Date): { nthWeek: number; dayOfWeek: number } {
  const dayOfWeek = date.getDay();
  const nth = Math.ceil(date.getDate() / 7);
  const oneWeekLater = new Date(date);
  oneWeekLater.setDate(date.getDate() + 7);
  const isLast = oneWeekLater.getMonth() !== date.getMonth();
  return { nthWeek: isLast ? -1 : nth, dayOfWeek };
}

const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function ordinal(n: number) {
  if (n === -1) return "last";
  return ["1st", "2nd", "3rd", "4th"][n - 1] ?? `${n}th`;
}

type RecurPreset = "weekly" | "fortnightly" | "every_3_weeks" | "every_4_weeks" | "monthly" | "custom_days";

type BuiltRule = {
  frequency: "days" | "weeks" | "months_nth_weekday";
  intervalCount: number;
  nthWeekOfMonth?: number;
  dayOfWeek?: number;
  firstOccurrenceAt: string;
  timezone: string;
  endType: "never" | "after_n" | "on_date";
  endAfterN?: number;
  endOnDate?: string;
};

function buildRecurrenceRule(args: {
  preset: RecurPreset;
  customIntervalCount: string;
  firstDate: Date;
  monthDesc: { nthWeek: number; dayOfWeek: number };
  endType: "never" | "after_n" | "on_date";
  endAfterN: string;
  endOnDate: string;
}): BuiltRule | null {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  let frequency: BuiltRule["frequency"];
  let intervalCount = 1;
  let nthWeekOfMonth: number | undefined;
  let dayOfWeek: number | undefined;

  switch (args.preset) {
    case "weekly":
      frequency = "weeks";
      intervalCount = 1;
      break;
    case "fortnightly":
      frequency = "weeks";
      intervalCount = 2;
      break;
    case "every_3_weeks":
      frequency = "weeks";
      intervalCount = 3;
      break;
    case "every_4_weeks":
      frequency = "weeks";
      intervalCount = 4;
      break;
    case "monthly":
      frequency = "months_nth_weekday";
      intervalCount = 1;
      nthWeekOfMonth = args.monthDesc.nthWeek;
      dayOfWeek = args.monthDesc.dayOfWeek;
      break;
    case "custom_days": {
      frequency = "days";
      const n = parseInt(args.customIntervalCount, 10);
      if (!Number.isFinite(n) || n < 1) return null;
      intervalCount = n;
      break;
    }
  }

  return {
    frequency,
    intervalCount,
    nthWeekOfMonth,
    dayOfWeek,
    firstOccurrenceAt: args.firstDate.toISOString(),
    timezone: tz,
    endType: args.endType,
    endAfterN: args.endType === "after_n" ? parseInt(args.endAfterN, 10) || undefined : undefined,
    endOnDate: args.endType === "on_date" ? args.endOnDate : undefined,
  };
}

// Mirror of computeOccurrences for the live preview. We only need the
// COUNT, not the actual dates — keep it simple.
function previewOccurrenceCount(rule: BuiltRule | null): { count: number; lastDate: Date | null } {
  if (!rule) return { count: 0, lastDate: null };
  const horizon = new Date();
  horizon.setMonth(horizon.getMonth() + 12);
  const first = new Date(rule.firstOccurrenceAt);
  const endOnDate = rule.endOnDate ? new Date(rule.endOnDate) : null;
  const cap = rule.endType === "after_n" ? rule.endAfterN ?? 9999 : 9999;

  const occ: Date[] = [];
  for (let i = 0; occ.length < cap && i < 5000; i += 1) {
    let next: Date;
    if (rule.frequency === "days") {
      next = new Date(first);
      next.setDate(first.getDate() + i * rule.intervalCount);
    } else if (rule.frequency === "weeks") {
      next = new Date(first);
      next.setDate(first.getDate() + i * rule.intervalCount * 7);
    } else {
      if (i === 0) {
        next = new Date(first);
      } else {
        const anchor = new Date(first);
        anchor.setMonth(first.getMonth() + i * rule.intervalCount);
        // Find Nth weekday of anchor's month.
        const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
        const monthEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
        const dow = rule.dayOfWeek ?? first.getDay();
        const nth = rule.nthWeekOfMonth ?? Math.ceil(first.getDate() / 7);
        let target: Date | null = null;
        if (nth === -1) {
          for (let d = new Date(monthEnd); d >= monthStart; d.setDate(d.getDate() - 1)) {
            if (d.getDay() === dow) { target = new Date(d); break; }
          }
        } else {
          const offset = (dow - monthStart.getDay() + 7) % 7;
          const candidate = new Date(monthStart);
          candidate.setDate(monthStart.getDate() + offset + (nth - 1) * 7);
          if (candidate <= monthEnd) target = candidate;
        }
        if (!target) continue;
        next = new Date(target);
        next.setHours(first.getHours(), first.getMinutes(), 0, 0);
      }
    }
    if (next > horizon) break;
    if (endOnDate && next > endOnDate) break;
    occ.push(next);
  }
  return { count: occ.length, lastDate: occ[occ.length - 1] ?? null };
}

function defaultDateTime(date?: string) {
  const base = date ? new Date(`${date}T08:00:00`) : new Date();
  base.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}T${pad(base.getHours())}:${pad(base.getMinutes())}`;
}

// ── Component ─────────────────────────────────────────────────────────

export function NewBookingModal({ defaultDate, onClose }: Props) {
  const router = useRouter();

  // Contact search
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ContactResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedContact, setSelectedContact] = useState<ContactResult | null>(null);
  const [showNewContact, setShowNewContact] = useState(false);

  // New contact fields
  const [ncFirstName, setNcFirstName] = useState("");
  const [ncLastName, setNcLastName] = useState("");
  const [ncEmail, setNcEmail] = useState("");
  const [ncPhone, setNcPhone] = useState("");

  // Vehicle
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>(""); // "" = new
  const [nvMake, setNvMake] = useState("");
  const [nvModel, setNvModel] = useState("");
  const [nvYear, setNvYear] = useState("");
  const [nvRego, setNvRego] = useState("");
  const [nvSize, setNvSize] = useState("");

  // Booking fields
  const [serviceName, setServiceName] = useState("");
  const [scheduledStart, setScheduledStart] = useState(defaultDateTime(defaultDate));
  const [durationMinutes, setDurationMinutes] = useState("");
  const [priceEstimate, setPriceEstimate] = useState("");
  const [locationType, setLocationType] = useState("shop");
  const [serviceAddress, setServiceAddress] = useState("");
  const [status, setStatus] = useState("confirmed");
  const [notes, setNotes] = useState("");

  // Recurring series. When isRecurring=true, submit hits /api/booking-series
  // instead of /api/bookings/manual.
  const [isRecurring, setIsRecurring] = useState(false);
  // Preset drives the frequency + intervalCount inferred values. "custom_*"
  // exposes the raw intervalCount input.
  const [recurPreset, setRecurPreset] = useState<
    "weekly" | "fortnightly" | "every_3_weeks" | "every_4_weeks" | "monthly" | "custom_days"
  >("weekly");
  const [customIntervalCount, setCustomIntervalCount] = useState("1");
  const [endType, setEndType] = useState<"never" | "after_n" | "on_date">("never");
  const [endAfterN, setEndAfterN] = useState("10");
  const [endOnDate, setEndOnDate] = useState("");

  // Notifications
  const [sendEmail, setSendEmail] = useState(true);
  const [sendSms, setSendSms] = useState(true);
  // Silent mode for importing historical bookings (e.g. Orbis migration).
  // When on, every other notification toggle is forced off and no scheduled
  // reminders are queued for the booking.
  const [silentMigration, setSilentMigration] = useState(false);

  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Debounced contact search
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const search = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.length < 2) { setResults([]); setSearching(false); return; }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const res = await fetch(`/api/contacts/search?q=${encodeURIComponent(q)}`);
      const data = (await res.json()) as { contacts: ContactResult[] };
      setResults(data.contacts);
      setSearching(false);
    }, 280);
  }, []);

  useEffect(() => { search(query); }, [query, search]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  function selectContact(c: ContactResult) {
    setSelectedContact(c);
    setQuery(c.full_name ?? c.email ?? "");
    setResults([]);
    setShowNewContact(false);
    // Pre-select first vehicle if only one
    if (c.vehicles.length === 1) {
      setSelectedVehicleId(c.vehicles[0].id);
    } else {
      setSelectedVehicleId("");
    }
  }

  function clearContact() {
    setSelectedContact(null);
    setQuery("");
    setResults([]);
    setShowNewContact(false);
    setSelectedVehicleId("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!selectedContact && !showNewContact) {
      setError("Please select or create a contact.");
      return;
    }
    if (showNewContact && !ncFirstName.trim() && !ncEmail.trim()) {
      setError("Please enter at least a first name or email for the new contact.");
      return;
    }
    if (!serviceName.trim()) {
      setError("Service name is required.");
      return;
    }
    if (!scheduledStart) {
      setError("Date & time is required.");
      return;
    }

    setSubmitting(true);

    const body: Record<string, unknown> = {
      service_name: serviceName.trim(),
      scheduled_start: new Date(scheduledStart).toISOString(),
      duration_minutes: durationMinutes ? Number(durationMinutes) : undefined,
      price_estimate: priceEstimate ? Number(priceEstimate) : undefined,
      location_type: locationType || undefined,
      service_address: locationType === "mobile" && serviceAddress.trim() ? serviceAddress.trim() : undefined,
      notes: notes || undefined,
      status,
      send_confirmation_email: silentMigration ? false : sendEmail,
      send_confirmation_sms: silentMigration ? false : sendSms,
      silent_migration: silentMigration,
    };

    if (selectedContact) {
      body.contact_id = selectedContact.id;
    } else {
      body.new_contact = {
        first_name: ncFirstName.trim() || undefined,
        last_name: ncLastName.trim() || undefined,
        email: ncEmail.trim() || undefined,
        phone: ncPhone.trim() || undefined,
      };
    }

    // Vehicle
    if (selectedVehicleId && selectedVehicleId !== "new") {
      body.vehicle_id = selectedVehicleId;
    } else if (nvMake || nvModel || nvYear || nvRego) {
      body.new_vehicle = {
        make: nvMake || undefined,
        model: nvModel || undefined,
        year: nvYear || undefined,
        rego: nvRego || undefined,
        size: nvSize || undefined,
      };
    }

    try {
      if (isRecurring) {
        // Series creation requires an existing contactId — recurring + new
        // contact in one shot would force us to first POST the contact,
        // which the series endpoint doesn't do. Block at the UI for now.
        if (!selectedContact) {
          setError("Pick an existing customer to create a recurring series. New-customer creation in the same step is coming later.");
          setSubmitting(false);
          return;
        }
        const firstDate = new Date(scheduledStart);
        const monthDesc = describeMonthlyNthWeekdayLocal(firstDate);
        const rule = buildRecurrenceRule({
          preset: recurPreset,
          customIntervalCount,
          firstDate,
          monthDesc,
          endType,
          endAfterN,
          endOnDate,
        });
        if (!rule) {
          setError("Could not build recurrence rule. Check the inputs.");
          setSubmitting(false);
          return;
        }
        const seriesBody = {
          contactId: selectedContact.id,
          vehicleId: selectedVehicleId && selectedVehicleId !== "new" ? selectedVehicleId : null,
          serviceName: serviceName.trim(),
          size: nvSize || undefined,
          priceEstimate: priceEstimate ? Number(priceEstimate) : undefined,
          durationMinutes: durationMinutes ? Number(durationMinutes) : undefined,
          locationType: locationType || undefined,
          serviceAddress: locationType === "mobile" && serviceAddress.trim() ? serviceAddress.trim() : undefined,
          notes: notes || undefined,
          rule,
        };
        const res = await fetch("/api/booking-series", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(seriesBody),
        });
        const data = (await res.json()) as { success: boolean; seriesId?: string; bookingsCreated?: number; error?: string };
        if (!res.ok || !data.success) {
          setError(data.error ?? "Failed to create series.");
          setSubmitting(false);
          return;
        }
        onClose();
        router.refresh();
        return;
      }

      const res = await fetch("/api/bookings/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { success: boolean; booking_id?: string; error?: string };
      if (!res.ok || !data.success) {
        setError(data.error ?? "Failed to create booking.");
        setSubmitting(false);
        return;
      }
      onClose();
      router.push(`/bookings/${data.booking_id}`);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  const vehicles = selectedContact?.vehicles ?? [];

  // Render via portal at document.body to escape any ancestor containing-
  // block. Without this, when the modal is launched from the global nav
  // button, the nav's backdrop-filter creates a containing block that
  // clips the modal's position:fixed overlay to the nav's 56px height.
  // The day-page button doesn't have that ancestor, which is why it
  // worked.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;

  const modalContent = (
    <div className="modalOverlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modalPanel" role="dialog" aria-modal="true" aria-label="New booking">
        <div className="modalHeader">
          <h2>New Booking</h2>
          <button className="modalClose" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="modalBody">

          {/* ── Contact ── */}
          <section className="modalSection">
            <h3>Contact</h3>

            {selectedContact ? (
              <div className="contactSelected">
                <div>
                  <strong>{selectedContact.full_name ?? "—"}</strong>
                  <span>{selectedContact.email}</span>
                  {selectedContact.phone && <span>{selectedContact.phone}</span>}
                </div>
                <button type="button" className="buttonGhost buttonNeutral" onClick={clearContact}>
                  Change
                </button>
              </div>
            ) : (
              <>
                {/* Tabs so it's obvious you can pick existing OR add new.
                    Previously the search box opened by default with the
                    "create new" link buried below as helper text — staff
                    were missing it and submitting bookings without contact
                    details. */}
                <div className="contactModeTabs">
                  <button
                    type="button"
                    className={`contactModeTab${!showNewContact ? " contactModeTab--active" : ""}`}
                    onClick={() => setShowNewContact(false)}
                  >
                    Existing customer
                  </button>
                  <button
                    type="button"
                    className={`contactModeTab${showNewContact ? " contactModeTab--active" : ""}`}
                    onClick={() => setShowNewContact(true)}
                  >
                    + New customer
                  </button>
                </div>
              </>
            )}

            {!selectedContact && showNewContact ? (
              <div className="newContactFields">
                <div className="modalRow2">
                  <div className="modalField">
                    <label>First name</label>
                    <input className="detailInput" value={ncFirstName} onChange={(e) => setNcFirstName(e.target.value)} placeholder="First name" />
                  </div>
                  <div className="modalField">
                    <label>Last name</label>
                    <input className="detailInput" value={ncLastName} onChange={(e) => setNcLastName(e.target.value)} placeholder="Last name" />
                  </div>
                </div>
                <div className="modalRow2">
                  <div className="modalField">
                    <label>Email</label>
                    <input className="detailInput" type="email" value={ncEmail} onChange={(e) => setNcEmail(e.target.value)} placeholder="email@example.com" />
                  </div>
                  <div className="modalField">
                    <label>Phone</label>
                    <input className="detailInput" type="tel" value={ncPhone} onChange={(e) => setNcPhone(e.target.value)} placeholder="021 000 0000" />
                  </div>
                </div>
              </div>
            ) : !selectedContact ? (
              <div className="contactSearch">
                <input
                  className="detailInput"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name, email, or phone…"
                />
                {searching && <div className="contactSearchHint">Searching…</div>}
                {results.length > 0 && (
                  <ul className="contactDropdown">
                    {results.map((c) => (
                      <li key={c.id} className="contactDropdownItem" onClick={() => selectContact(c)}>
                        <strong>{c.full_name ?? "—"}</strong>
                        <span>{[c.email, c.phone].filter(Boolean).join(" · ")}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {query.length >= 2 && !searching && results.length === 0 && (
                  <div className="contactSearchHint">
                    No contacts found. Switch to the <strong>+ New customer</strong> tab above to create one.
                  </div>
                )}
              </div>
            ) : null}
          </section>

          {/* ── Vehicle ── */}
          <section className="modalSection">
            <h3>Vehicle <span className="modalOptional">(optional)</span></h3>

            {vehicles.length > 0 && (
              <div className="modalField">
                <label>Select vehicle</label>
                <select
                  className="detailInput"
                  value={selectedVehicleId}
                  onChange={(e) => setSelectedVehicleId(e.target.value)}
                >
                  <option value="">— Add new vehicle —</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>{vehicleLabel(v)}</option>
                  ))}
                </select>
              </div>
            )}

            {(selectedVehicleId === "" || selectedVehicleId === "new") && (
              <div className="modalRow3">
                <div className="modalField">
                  <label>Make</label>
                  <input className="detailInput" value={nvMake} onChange={(e) => setNvMake(e.target.value)} placeholder="Toyota" />
                </div>
                <div className="modalField">
                  <label>Model</label>
                  <input className="detailInput" value={nvModel} onChange={(e) => setNvModel(e.target.value)} placeholder="Corolla" />
                </div>
                <div className="modalField">
                  <label>Year</label>
                  <input className="detailInput" value={nvYear} onChange={(e) => setNvYear(e.target.value)} placeholder="2020" />
                </div>
                <div className="modalField">
                  <label>Rego</label>
                  <input className="detailInput" value={nvRego} onChange={(e) => setNvRego(e.target.value)} placeholder="ABC123" />
                </div>
                <div className="modalField">
                  <label>Size</label>
                  <select className="detailInput" value={nvSize} onChange={(e) => setNvSize(e.target.value)}>
                    <option value="">— Size —</option>
                    <option value="small">Small</option>
                    <option value="medium">Medium</option>
                    <option value="large">Large</option>
                    <option value="suv">SUV</option>
                    <option value="van">Van/Truck</option>
                  </select>
                </div>
              </div>
            )}
          </section>

          {/* ── Booking details ── */}
          <section className="modalSection">
            <h3>Booking</h3>

            <div className="modalField">
              <label>Service name <span className="modalRequired">*</span></label>
              <input
                className="detailInput"
                value={serviceName}
                onChange={(e) => setServiceName(e.target.value)}
                placeholder="e.g. Full Detail, Express Wash…"
                required
              />
            </div>

            <div className="modalRow2">
              <div className="modalField">
                <label>Date & time <span className="modalRequired">*</span></label>
                <input
                  className="detailInput"
                  type="datetime-local"
                  value={scheduledStart}
                  onChange={(e) => setScheduledStart(e.target.value)}
                  required
                />
              </div>
              <div className="modalField">
                <label>Duration (min)</label>
                <input
                  className="detailInput"
                  type="number"
                  min="0"
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(e.target.value)}
                  placeholder="e.g. 120"
                />
              </div>
            </div>

            <div className="modalRow2">
              <div className="modalField">
                <label>Price estimate ($)</label>
                <input
                  className="detailInput"
                  type="number"
                  min="0"
                  step="0.01"
                  value={priceEstimate}
                  onChange={(e) => setPriceEstimate(e.target.value)}
                  placeholder="e.g. 250"
                />
              </div>
              <div className="modalField">
                <label>Location</label>
                <select className="detailInput" value={locationType} onChange={(e) => setLocationType(e.target.value)}>
                  <option value="shop">Shop</option>
                  <option value="mobile">Mobile</option>
                  <option value="">Not set</option>
                </select>
              </div>
            </div>

            {locationType === "mobile" && (
              <div className="modalField">
                <label>Service address</label>
                <input
                  className="detailInput"
                  value={serviceAddress}
                  onChange={(e) => setServiceAddress(e.target.value)}
                  placeholder="e.g. 123 Cuba St, Te Aro, Wellington"
                />
              </div>
            )}

            {/* ── Recurring ── */}
            <div className="modalField">
              <label className="modalCheckbox" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <input
                  type="checkbox"
                  checked={isRecurring}
                  onChange={(e) => setIsRecurring(e.target.checked)}
                />
                Make this recurring
              </label>
            </div>

            {isRecurring && (() => {
              const firstDate = scheduledStart ? new Date(scheduledStart) : new Date();
              const monthDesc = describeMonthlyNthWeekdayLocal(firstDate);
              const rule = buildRecurrenceRule({
                preset: recurPreset,
                customIntervalCount,
                firstDate,
                monthDesc,
                endType,
                endAfterN,
                endOnDate,
              });
              const preview = previewOccurrenceCount(rule);
              const previewLabel = preview.lastDate
                ? `Generates ~${preview.count} bookings through ${preview.lastDate.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`
                : "No occurrences with these settings.";
              return (
                <div style={{ border: "1px solid rgba(0,0,0,0.08)", borderRadius: 8, padding: 12, marginTop: 4 }}>
                  <div className="modalRow2">
                    <div className="modalField">
                      <label>Frequency</label>
                      <select
                        className="detailInput"
                        value={recurPreset}
                        onChange={(e) => setRecurPreset(e.target.value as RecurPreset)}
                      >
                        <option value="weekly">Weekly</option>
                        <option value="fortnightly">Fortnightly (every 2 weeks)</option>
                        <option value="every_3_weeks">Every 3 weeks</option>
                        <option value="every_4_weeks">Every 4 weeks</option>
                        <option value="monthly">Monthly (every Nth weekday)</option>
                        <option value="custom_days">Custom (every N days)</option>
                      </select>
                    </div>
                    {recurPreset === "custom_days" && (
                      <div className="modalField">
                        <label>Every N days</label>
                        <input
                          className="detailInput"
                          type="number"
                          min="1"
                          value={customIntervalCount}
                          onChange={(e) => setCustomIntervalCount(e.target.value)}
                        />
                      </div>
                    )}
                  </div>

                  {recurPreset === "monthly" && (
                    <div style={{ fontSize: 13, color: "#5c5148", marginBottom: 8 }}>
                      Repeats on the <strong>{ordinal(monthDesc.nthWeek)} {WEEKDAY_LABELS[monthDesc.dayOfWeek]}</strong> of each month
                      <small style={{ display: "block", marginTop: 2 }}>
                        Derived from the date you picked above. Change the date to change the rule.
                      </small>
                    </div>
                  )}

                  <div className="modalField">
                    <label>Ends</label>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <label className="modalCheckbox" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <input
                          type="radio"
                          name="endType"
                          checked={endType === "never"}
                          onChange={() => setEndType("never")}
                        />
                        Forever (rolling 12-month horizon)
                      </label>
                      <label className="modalCheckbox" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <input
                          type="radio"
                          name="endType"
                          checked={endType === "after_n"}
                          onChange={() => setEndType("after_n")}
                        />
                        After
                        <input
                          className="detailInput"
                          type="number"
                          min="1"
                          value={endAfterN}
                          onChange={(e) => setEndAfterN(e.target.value)}
                          disabled={endType !== "after_n"}
                          style={{ width: 80 }}
                        />
                        occurrences
                      </label>
                      <label className="modalCheckbox" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <input
                          type="radio"
                          name="endType"
                          checked={endType === "on_date"}
                          onChange={() => setEndType("on_date")}
                        />
                        On date
                        <input
                          className="detailInput"
                          type="date"
                          value={endOnDate}
                          onChange={(e) => setEndOnDate(e.target.value)}
                          disabled={endType !== "on_date"}
                        />
                      </label>
                    </div>
                  </div>

                  <div style={{ fontSize: 13, color: "#5c5148", marginTop: 8 }}>
                    {previewLabel}
                  </div>
                </div>
              );
            })()}

            <div className="modalRow2">
              <div className="modalField">
                <label>Status</label>
                <select className="statusSelect detailInput" value={status} onChange={(e) => setStatus(e.target.value)} data-status={status}>
                  <option value="confirmed">Confirmed</option>
                  <option value="pending">Pending</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            </div>

            <div className="modalField">
              <label>Notes</label>
              <textarea
                className="detailTextarea"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any notes…"
              />
            </div>
          </section>

          {/* ── Notifications ── */}
          <section className="modalSection">
            <h3>Notifications</h3>
            <div className="modalCheckboxRow">
              <label className="modalCheckbox">
                <input
                  type="checkbox"
                  checked={sendEmail && !silentMigration}
                  disabled={silentMigration}
                  onChange={(e) => setSendEmail(e.target.checked)}
                />
                Send confirmation email to customer
              </label>
              <label className="modalCheckbox">
                <input
                  type="checkbox"
                  checked={sendSms && !silentMigration}
                  disabled={silentMigration}
                  onChange={(e) => setSendSms(e.target.checked)}
                />
                Send confirmation SMS to customer
              </label>
              <label
                className="modalCheckbox"
                style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(0,0,0,0.08)" }}
                title="Use this when migrating historical bookings from another system. Skips ALL customer/team emails, SMS, and future reminders for this booking."
              >
                <input
                  type="checkbox"
                  checked={silentMigration}
                  onChange={(e) => setSilentMigration(e.target.checked)}
                />
                <span style={{ display: "inline-flex", flexDirection: "column" }}>
                  <strong>Silent migration mode</strong>
                  <small style={{ color: "#5c5148", fontWeight: 400 }}>
                    Skip every email/SMS + reminder for this booking. Use when importing past jobs from another CRM.
                  </small>
                </span>
              </label>
            </div>
          </section>

          {error && <p className="editorError modalError">{error}</p>}

          <div className="modalFooter">
            <button type="button" className="buttonGhost buttonNeutral" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="buttonPrimary" disabled={submitting}>
              {submitting ? "Creating…" : "Create Booking"}
            </button>
          </div>

        </form>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
