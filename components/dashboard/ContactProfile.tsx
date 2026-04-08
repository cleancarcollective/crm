import Link from "next/link";

import { StatusBadge } from "@/components/dashboard/StatusBadge";
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
  const { contact, shop, vehicles, bookings, leads, emails } = profile;
  const displayName =
    contact.full_name || [contact.first_name, contact.last_name].filter(Boolean).join(" ") || "Unknown contact";

  return (
    <main className="pageShell">
      <div className="pageTopbar">
        <div>
          <p className="eyebrow">Lead profile</p>
          <h1 className="pageTitle">{displayName}</h1>
          <p className="detailSubtitle">{shop.name}</p>
        </div>
        <div className="topbarMeta">
          <Link href="/" className="textLink">
            Back to calendar
          </Link>
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
                <span>{lead.source_detail ?? lead.source}</span>
                <span>{formatDateTime(lead.updated_at, shop.timezone, "EEE d MMM yyyy, h:mm a")}</span>
                {lead.notes ? <p className="profileNotes">{lead.notes}</p> : null}
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
