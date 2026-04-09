"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

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
  const [status, setStatus] = useState("confirmed");
  const [notes, setNotes] = useState("");

  // Notifications
  const [sendEmail, setSendEmail] = useState(true);
  const [sendSms, setSendSms] = useState(true);

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
      notes: notes || undefined,
      status,
      send_confirmation_email: sendEmail,
      send_confirmation_sms: sendSms,
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

  return (
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
            ) : showNewContact ? (
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
                <button type="button" className="buttonGhost buttonNeutral" onClick={() => setShowNewContact(false)}>
                  ← Search existing
                </button>
              </div>
            ) : (
              <div className="contactSearch">
                <input
                  className="detailInput"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name, email, or phone…"
                  autoFocus
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
                    No contacts found.{" "}
                    <button type="button" className="inlineLink" onClick={() => setShowNewContact(true)}>
                      Create new contact
                    </button>
                  </div>
                )}
                {query.length < 2 && (
                  <div className="contactSearchHint">
                    or{" "}
                    <button type="button" className="inlineLink" onClick={() => setShowNewContact(true)}>
                      create a new contact
                    </button>
                  </div>
                )}
              </div>
            )}
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
                <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
                Send confirmation email to customer
              </label>
              <label className="modalCheckbox">
                <input type="checkbox" checked={sendSms} onChange={(e) => setSendSms(e.target.checked)} />
                Send confirmation SMS to customer
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
}
