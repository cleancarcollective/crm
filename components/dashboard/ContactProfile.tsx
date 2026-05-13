import Link from "next/link";

import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { ArchiveButton } from "@/components/dashboard/ArchiveButton";
import { ContactNotesEditor } from "@/components/dashboard/ContactNotesEditor";
import { LeadEstimatePanel } from "@/components/dashboard/LeadEstimatePanel";
import { LeadNotesEditor } from "@/components/dashboard/LeadNotesEditor";
import { LeadSourceEditor } from "@/components/dashboard/LeadSourceEditor";
import { getVehicleLabel } from "@/lib/dashboard/bookings";
import { formatCurrency, formatDateTime } from "@/lib/dashboard/format";
import type { ContactProfile as ContactProfileData } from "@/lib/dashboard/types";

type ContactProfileProps = {
  profile: ContactProfileData;
};

function readPreview(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

export function ContactProfile({ profile }: ContactProfileProps) {
  const { contact, shop, vehicles, bookings, leads, emails, credits } = profile;
  const displayName =
    contact.full_name || [contact.first_name, contact.last_name].filter(Boolean).join(" ") || "Unknown contact";

  return (
    <main className="pageShell">
      <div className="pageTopbar">
        <div>
          <p className="eyebrow">Contact profile</p>
          <h1 className="pageTitle">{displayName}</h1>
          <p className="detailSubtitle">{shop.name}</p>
        </div>
        <div className="topbarMeta">
          <Link href="/" className="textLink">
            Back to calendar
          </Link>
          <ArchiveButton type="contact" id={contact.id} redirectAfter="/clients" />
        </div>
      </div>

      <div className="summaryStrip">
        <div className="summaryCard">
          <span>Vehicles</span>
          <strong>{vehicles.length}</strong>
        </div>
        <div className="summaryCard">
          <span>Bookings</span>
          <strong>{bookings.length}</strong>
        </div>
        <div className="summaryCard">
          <span>Messages</span>
          <strong>{emails.length}</strong>
        </div>
      </div>

      {credits && credits.length > 0 ? (
        <section
          className="detailPanel"
          style={{
            borderLeft: "3px solid #f4b942",
            background: "linear-gradient(90deg, rgba(244,185,66,0.10) 0%, rgba(255,255,255,0.86) 320px)",
            marginBottom: 16,
          }}
        >
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            🎁 Outstanding credits
            <span className="directoryBadge directoryBadge--needsApproval">{credits.length}</span>
          </h2>
          <div className="profileStack">
            {credits.map((c) => (
              <div key={c.id} className="profileCard">
                <strong>{c.service_name}</strong>
                {c.description ? <span>{c.description}</span> : null}
                <span style={{ color: "#9e9189", fontSize: 12 }}>
                  Granted {formatDateTime(c.created_at, shop.timezone, "d MMM yyyy")} · {c.source}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <ContactNotesEditor contactId={contact.id} initialNotes={contact.notes ?? null} />

      <div className="profileGrid">
        <section className="detailPanel">
          <h2>Contact</h2>
          <div className="detailItem">
            <span>Name</span>
            <strong>{displayName}</strong>
          </div>
          <div className="detailItem">
            <span>Email</span>
            <strong>{contact.email ?? "—"}</strong>
          </div>
          <div className="detailItem">
            <span>Phone</span>
            <strong>{contact.phone ?? "—"}</strong>
          </div>
          <div className="detailItem">
            <span>Created</span>
            <strong>{contact.created_at ? formatDateTime(contact.created_at, shop.timezone, "EEE d MMM yyyy, h:mm a") : "—"}</strong>
          </div>
        </section>

        <section className="detailPanel">
          <h2>Vehicles</h2>
          {vehicles.length === 0 ? (
            <p className="profileEmpty">No vehicles linked yet.</p>
          ) : (
            <div className="profileStack">
              {vehicles.map((vehicle) => (
                <div key={vehicle.id} className="profileCard">
                  <strong>{[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Vehicle"}</strong>
                  <span>{vehicle.size ?? "Size not set"}</span>
                  {vehicle.rego ? <span>Rego: {vehicle.rego}</span> : null}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="detailPanel">
        <h2>Lead history</h2>
        {leads.length === 0 ? (
          <p className="profileEmpty">No leads recorded.</p>
        ) : (
          <div className="profileStack">
            {leads.map((lead) => (
              <div key={lead.id} className="profileCard">
                <div className="profileCardTop">
                  <strong>{lead.service_requested ?? "General enquiry"}</strong>
                  <StatusBadge status={lead.status} />
                </div>
                <span>{lead.vehicle ? [lead.vehicle.year, lead.vehicle.make, lead.vehicle.model].filter(Boolean).join(" ") : "Vehicle not linked"}</span>
                <LeadSourceEditor leadId={lead.id} currentSource={lead.source_detail ?? lead.source} />
                <span>{formatDateTime(lead.updated_at, shop.timezone, "EEE d MMM yyyy, h:mm a")}</span>
                <LeadNotesEditor leadId={lead.id} initialNotes={lead.notes ?? null} />
                <LeadEstimatePanel
                  leadId={lead.id}
                  currentStatus={lead.status}
                  draftSubject={lead.quote_subject ?? null}
                  draftBody={lead.quote_body ?? null}
                  internalNote={lead.internal_notes ?? null}
                  confidence={lead.confidence ?? null}
                  suggestedSize={lead.suggested_size ?? null}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="detailPanel">
        <h2>Appointment history</h2>
        {bookings.length === 0 ? (
          <p className="profileEmpty">No appointments yet.</p>
        ) : (
          <div className="profileStack">
            {bookings.map((booking) => (
              <div key={booking.id} className="profileCard">
                <div className="profileCardTop">
                  <Link href={`/bookings/${booking.id}`} className="profilePrimaryLink">
                    {booking.service_name}
                  </Link>
                  <StatusBadge status={booking.status} />
                </div>
                <span>{formatDateTime(booking.scheduled_start, shop.timezone, "EEE d MMM yyyy, h:mm a")}</span>
                <span>{getVehicleLabel(booking)}</span>
                <span>{booking.location_type ?? "Location not set"}</span>
                <span>{formatCurrency(booking.price_estimate)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="detailPanel">
        <h2>Communication history</h2>
        {emails.length === 0 ? (
          <p className="profileEmpty">No emails recorded for this contact yet.</p>
        ) : (
          <div className="profileStack">
            {emails.map((email) => (
              <details key={email.id} className="commCard">
                <summary className="commSummary">
                  <div className="commSummaryMain">
                    <strong>{email.subject}</strong>
                    <span>{formatDateTime(email.sent_at ?? email.created_at, shop.timezone, "EEE d MMM yyyy, h:mm a")}</span>
                    <span>{readPreview(email.body_rendered)}</span>
                  </div>
                  <div className="commSummaryMeta">
                    <StatusBadge status={email.status} />
                  </div>
                </summary>
                <div className="commBody">
                  {email.booking_id ? (
                    <p className="commBodyLinkRow">
                      <Link href={`/bookings/${email.booking_id}`} className="profileMetaLink">
                        Open linked booking
                      </Link>
                    </p>
                  ) : null}
                  <div className="commBodyFrame" dangerouslySetInnerHTML={{ __html: email.body_rendered }} />
                  {email.events.length > 0 ? (
                    <div className="commEvents">
                      <p>Delivery events</p>
                      <ul>
                        {email.events.map((event) => (
                          <li key={event.id}>
                            <strong>{event.event_type}</strong>
                            <span>{formatDateTime(event.event_timestamp, shop.timezone, "EEE d MMM yyyy, h:mm a")}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </details>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
