"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

// Both CCC shops are NZ - hardcode for now. Prevents datetime-local
// input from drifting when the user's browser or SSR node is in a
// non-NZ timezone (Vercel default = UTC).
const SHOP_TZ = "Pacific/Auckland";

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

/**
 * Lightweight pre-fill shape: just enough to satisfy the contact-selected
 * state without forcing the caller to also hand us a vehicles list (those
 * are passed separately via initialVehicle if known).
 */
export type InitialContact = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
};

export type InitialVehicle = {
  id: string;
  make: string | null;
  model: string | null;
  year: string | null;
  rego: string | null;
  size: string | null;
};

type PricingService = {
  name: string;
  /** size label → ex-GST price. Flat-priced services carry only "Any". */
  sizes: Record<string, number>;
};

// Display order for the size toggle. We only render sizes the selected
// service actually has a price for.
const SIZE_ORDER = ["Small", "Medium", "Large", "XL"];

type Props = {
  defaultDate?: string; // yyyy-MM-dd
  onClose: () => void;
  /** Pre-select this contact (skips the search UI). The "+ New customer"
   *  toggle defaults to OFF when this is set. */
  initialContact?: InitialContact | null;
  /** Optional vehicle pre-selection. Only honoured when initialContact is
   *  set; appears in the vehicle dropdown alongside any others. */
  initialVehicle?: InitialVehicle | null;
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
  // Recurrence expands server-side in this timezone. Must be the SHOP's
  // tz, not the staffer's browser tz (Max books from the US).
  const tz = SHOP_TZ;
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
  // If a specific yyyy-MM-dd is passed (e.g. from day-detail page), open
  // at 8am shop-local on that day. Otherwise use "now" rendered as NZ
  // wall-clock time regardless of browser/SSR tz.
  if (date) return `${date}T08:00`;
  return formatInTimeZone(new Date(), SHOP_TZ, "yyyy-MM-dd'T'HH:mm");
}

// ── Component ─────────────────────────────────────────────────────────

export function NewBookingModal({ defaultDate, onClose, initialContact, initialVehicle }: Props) {
  const router = useRouter();

  // Seed the selectedContact from initialContact, folding any pre-known
  // vehicle into its vehicles list so the dropdown shows it.
  const seededContact: ContactResult | null = initialContact
    ? {
        id: initialContact.id,
        first_name: initialContact.first_name,
        last_name: initialContact.last_name,
        full_name: initialContact.full_name,
        email: initialContact.email,
        phone: initialContact.phone,
        vehicles: initialVehicle ? [initialVehicle] : [],
      }
    : null;

  // Contact search
  const [query, setQuery] = useState(
    seededContact ? seededContact.full_name ?? seededContact.email ?? "" : ""
  );
  const [results, setResults] = useState<ContactResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedContact, setSelectedContact] = useState<ContactResult | null>(seededContact);
  const [showNewContact, setShowNewContact] = useState(false);

  // New contact fields
  const [ncFirstName, setNcFirstName] = useState("");
  const [ncLastName, setNcLastName] = useState("");
  const [ncEmail, setNcEmail] = useState("");
  const [ncPhone, setNcPhone] = useState("");

  // Vehicle
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>(
    initialVehicle ? initialVehicle.id : ""
  ); // "" = new
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
  // Tracks whether the price field was auto-filled from the pricing table
  // (so we know not to clobber a manual override on subsequent size changes).
  const [priceManuallyEdited, setPriceManuallyEdited] = useState(false);
  // Multiple services on one booking (e.g. Paint Correction + Ceramic). The
  // picker stages one line; "Add" banks it here. On submit the names are joined
  // with " & " and prices summed, matching how combined bookings were entered.
  const [addedServices, setAddedServices] = useState<{ name: string; price: number }[]>([]);

  // Pricing catalogue for the current shop. Loaded once on mount.
  // serviceMode: "catalogue" = picked from dropdown, "custom" = typed freehand.
  const [pricing, setPricing] = useState<PricingService[]>([]);
  const [serviceMode, setServiceMode] = useState<"catalogue" | "custom">("catalogue");
  const [selectedSize, setSelectedSize] = useState<string>("");
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

  // Load the shop's pricing catalogue once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/pricing");
        if (!res.ok) return;
        const data = (await res.json()) as { services: PricingService[] };
        if (!cancelled) setPricing(data.services ?? []);
      } catch {
        // Non-fatal — modal falls back to free-text service entry.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Currently-selected catalogue service (if any).
  const selectedService = pricing.find((s) => s.name === serviceName) ?? null;
  // Which size chips to show: the sizes this service is priced for, in order.
  // A flat-priced service (only "Any") shows no size toggle.
  const availableSizes = selectedService
    ? SIZE_ORDER.filter((sz) => selectedService.sizes[sz] !== undefined)
    : [];
  const isFlatPriced = !!selectedService && availableSizes.length === 0 && selectedService.sizes["Any"] !== undefined;

  /** Apply the catalogue price for a service+size unless manually overridden. */
  function applyCataloguePrice(service: PricingService | null, size: string) {
    if (!service || priceManuallyEdited) return;
    let price: number | undefined;
    if (size && service.sizes[size] !== undefined) price = service.sizes[size];
    else if (service.sizes["Any"] !== undefined) price = service.sizes["Any"];
    if (price !== undefined) setPriceEstimate(String(price));
  }

  function pickService(name: string) {
    setServiceName(name);
    setPriceManuallyEdited(false);
    const svc = pricing.find((s) => s.name === name) ?? null;
    if (!svc) { setSelectedSize(""); return; }
    // Pre-pick a size: keep the vehicle's known size if it matches, else
    // default to the first available, else flat-price "Any".
    const sizes = SIZE_ORDER.filter((sz) => svc.sizes[sz] !== undefined);
    if (sizes.length === 0) {
      setSelectedSize("");
      applyCataloguePrice(svc, "");
      return;
    }
    const vehicleSizeMatch = sizes.find((sz) => sz.toLowerCase() === nvSize.toLowerCase());
    const initialSize = vehicleSizeMatch ?? sizes[0];
    setSelectedSize(initialSize);
    applyCataloguePrice(svc, initialSize);
  }

  function pickSize(size: string) {
    setSelectedSize(size);
    setPriceManuallyEdited(false);
    applyCataloguePrice(selectedService, size);
  }

  // Bank the staged service line so another can be added.
  function addCurrentService() {
    if (!serviceName.trim()) return;
    setAddedServices((prev) => [...prev, { name: serviceName.trim(), price: Number(priceEstimate) || 0 }]);
    setServiceName("");
    setSelectedSize("");
    setPriceEstimate("");
    setPriceManuallyEdited(false);
    setServiceMode("catalogue");
  }
  function removeAddedService(idx: number) {
    setAddedServices((prev) => prev.filter((_, i) => i !== idx));
  }
  // Everything that will actually be booked: banked lines plus the staged one.
  const allBookingServices = [
    ...addedServices,
    ...(serviceName.trim() ? [{ name: serviceName.trim(), price: Number(priceEstimate) || 0 }] : []),
  ];
  const combinedServiceName = allBookingServices.map((s) => s.name).join(" & ");
  const combinedPrice = allBookingServices.reduce((a, s) => a + s.price, 0);

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
    if (allBookingServices.length === 0) {
      setError("Add at least one service.");
      return;
    }
    if (!scheduledStart) {
      setError("Date & time is required.");
      return;
    }

    setSubmitting(true);

    const body: Record<string, unknown> = {
      service_name: combinedServiceName,
      scheduled_start: fromZonedTime(scheduledStart, SHOP_TZ).toISOString(),
      duration_minutes: durationMinutes ? Number(durationMinutes) : undefined,
      price_estimate: combinedPrice > 0 ? combinedPrice : undefined,
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
        const firstDate = fromZonedTime(scheduledStart, SHOP_TZ);
        // Weekday/nth-week must come from the NZ WALL-CLOCK the staffer
        // typed, not the UTC instant re-read through browser-local
        // getters (wrong day when logged in from the US). Parsing the
        // raw datetime-local string gives local getters = typed values.
        const monthDesc = describeMonthlyNthWeekdayLocal(new Date(scheduledStart));
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
        // Mirror the manual-booking payload shape: either contactId for
        // existing customers, or newContact (and optionally newVehicle) so
        // the series endpoint can dedupe + create on the fly.
        const seriesBody: Record<string, unknown> = {
          serviceName: combinedServiceName,
          size: nvSize || undefined,
          priceEstimate: combinedPrice > 0 ? combinedPrice : undefined,
          durationMinutes: durationMinutes ? Number(durationMinutes) : undefined,
          locationType: locationType || undefined,
          serviceAddress: locationType === "mobile" && serviceAddress.trim() ? serviceAddress.trim() : undefined,
          notes: notes || undefined,
          rule,
        };
        if (selectedContact) {
          seriesBody.contactId = selectedContact.id;
        } else {
          seriesBody.newContact = {
            first_name: ncFirstName.trim() || undefined,
            last_name: ncLastName.trim() || undefined,
            email: ncEmail.trim() || undefined,
            phone: ncPhone.trim() || undefined,
          };
        }
        if (selectedVehicleId && selectedVehicleId !== "new") {
          seriesBody.vehicleId = selectedVehicleId;
        } else if (nvMake || nvModel || nvYear || nvRego) {
          seriesBody.newVehicle = {
            make: nvMake || undefined,
            model: nvModel || undefined,
            year: nvYear || undefined,
            rego: nvRego || undefined,
            size: nvSize || undefined,
          };
        }
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
              {addedServices.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 6 }}>
                  {addedServices.map((s, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 10px", background: "#f1f5f9", borderRadius: 8, fontSize: 13 }}>
                      <span>{s.name}{s.price ? ` — $${s.price} ex GST` : ""}</span>
                      <button type="button" onClick={() => removeAddedService(i)} style={{ border: "none", background: "transparent", color: "#dc2626", cursor: "pointer", fontSize: 16, lineHeight: 1 }} aria-label="Remove service">×</button>
                    </div>
                  ))}
                </div>
              ) : null}
              {serviceMode === "catalogue" && pricing.length > 0 ? (
                <>
                  <select
                    className="detailInput"
                    value={selectedService ? serviceName : ""}
                    onChange={(e) => {
                      if (e.target.value === "__custom__") {
                        setServiceMode("custom");
                        setServiceName("");
                        setSelectedSize("");
                        setPriceManuallyEdited(false);
                        return;
                      }
                      pickService(e.target.value);
                    }}
                  >
                    <option value="">— Select a service —</option>
                    {pricing.map((s) => (
                      <option key={s.name} value={s.name}>{s.name}</option>
                    ))}
                    <option value="__custom__">✏️ Enter manually…</option>
                  </select>
                </>
              ) : (
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    className="detailInput"
                    value={serviceName}
                    onChange={(e) => setServiceName(e.target.value)}
                    placeholder="e.g. Full Detail, Express Wash…"
                    required
                    style={{ flex: 1 }}
                  />
                  {pricing.length > 0 ? (
                    <button
                      type="button"
                      className="buttonGhost"
                      style={{ fontSize: 12, whiteSpace: "nowrap" }}
                      onClick={() => { setServiceMode("catalogue"); setServiceName(""); }}
                    >
                      Pick from list
                    </button>
                  ) : null}
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
                <button type="button" className="buttonGhost" style={{ fontSize: 12 }} disabled={!serviceName.trim()} onClick={addCurrentService}>
                  + Add another service
                </button>
                {allBookingServices.length > 1 ? (
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Total: ${combinedPrice} ex GST</span>
                ) : null}
              </div>
            </div>

            {/* Size toggle — only for catalogue services priced by size. */}
            {serviceMode === "catalogue" && availableSizes.length > 0 ? (
              <div className="modalField">
                <label>Vehicle size</label>
                <div style={{ display: "flex", gap: 6 }}>
                  {availableSizes.map((sz) => {
                    const active = selectedSize === sz;
                    return (
                      <button
                        key={sz}
                        type="button"
                        onClick={() => pickSize(sz)}
                        style={{
                          flex: 1,
                          padding: "6px 4px",
                          fontSize: 13,
                          fontWeight: active ? 700 : 500,
                          border: active ? "2px solid #2563eb" : "1px solid rgba(0,0,0,0.15)",
                          borderRadius: 8,
                          background: active ? "#dbeafe" : "white",
                          color: "#1f2937",
                          cursor: "pointer",
                        }}
                      >
                        {sz}
                        {selectedService?.sizes[sz] !== undefined ? (
                          <span style={{ display: "block", fontSize: 11, color: "#5c5148", fontWeight: 400 }}>
                            ${selectedService.sizes[sz]}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {serviceMode === "catalogue" && isFlatPriced ? (
              <div style={{ fontSize: 12, color: "#5c5148", marginTop: -4, marginBottom: 4 }}>
                Flat price — ${selectedService?.sizes["Any"]} ex GST (no size variants).
              </div>
            ) : null}

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
                <label>Duration</label>
                {(() => {
                  const totalMin = Number(durationMinutes) || 0;
                  const d = Math.floor(totalMin / 1440);
                  const h = Math.floor((totalMin % 1440) / 60);
                  const m = totalMin % 60;
                  const update = (nd: number, nh: number, nm: number) => {
                    const t = Math.max(0, nd) * 1440 + Math.max(0, nh) * 60 + Math.max(0, nm);
                    setDurationMinutes(t > 0 ? String(t) : "");
                  };
                  return (
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input
                        className="detailInput"
                        type="number"
                        min="0"
                        value={d || ""}
                        onChange={(e) => update(Number(e.target.value), h, m)}
                        placeholder="0"
                        style={{ width: 56 }}
                      />
                      <span style={{ fontSize: 12, color: "#666" }}>d</span>
                      <input
                        className="detailInput"
                        type="number"
                        min="0"
                        max="23"
                        value={h || ""}
                        onChange={(e) => update(d, Number(e.target.value), m)}
                        placeholder="0"
                        style={{ width: 56 }}
                      />
                      <span style={{ fontSize: 12, color: "#666" }}>h</span>
                      <input
                        className="detailInput"
                        type="number"
                        min="0"
                        max="59"
                        value={m || ""}
                        onChange={(e) => update(d, h, Number(e.target.value))}
                        placeholder="0"
                        style={{ width: 56 }}
                      />
                      <span style={{ fontSize: 12, color: "#666" }}>m</span>
                      {totalMin > 0 ? (
                        <span style={{ fontSize: 11, color: "#888", whiteSpace: "nowrap" }}>= {totalMin} min</span>
                      ) : null}
                    </div>
                  );
                })()}
              </div>
            </div>

            <div className="modalRow2">
              <div className="modalField">
                <label>
                  Price estimate ($ ex GST)
                  {selectedService && !priceManuallyEdited ? (
                    <span style={{ fontSize: 11, color: "#16a34a", marginLeft: 6 }}>auto</span>
                  ) : priceManuallyEdited ? (
                    <span style={{ fontSize: 11, color: "#d97706", marginLeft: 6 }}>overridden</span>
                  ) : null}
                </label>
                <input
                  className="detailInput"
                  type="number"
                  min="0"
                  step="0.01"
                  value={priceEstimate}
                  onChange={(e) => { setPriceEstimate(e.target.value); setPriceManuallyEdited(true); }}
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
              const firstDate = scheduledStart ? fromZonedTime(scheduledStart, SHOP_TZ) : new Date();
              // NZ wall-clock for weekday math - see comment in handleSubmit.
              const monthDesc = describeMonthlyNthWeekdayLocal(scheduledStart ? new Date(scheduledStart) : new Date());
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
