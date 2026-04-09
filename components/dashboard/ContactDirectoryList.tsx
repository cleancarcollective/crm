import Link from "next/link";

import { LeadStatusActions } from "@/components/dashboard/LeadStatusActions";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { formatCurrency, formatDateTime } from "@/lib/dashboard/format";
import type { ClientDirectoryEntry, LeadDirectoryEntry } from "@/lib/dashboard/types";

type ContactDirectoryListProps =
  | {
      mode: "leads";
      entries: LeadDirectoryEntry[];
      timezone: string;
    }
  | {
      mode: "clients";
      entries: ClientDirectoryEntry[];
      timezone: string;
    };

function getDisplayName({
  full_name,
  first_name,
  last_name,
}: {
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
}) {
  return full_name || [first_name, last_name].filter(Boolean).join(" ") || "Unknown contact";
}

export function ContactDirectoryList(props: ContactDirectoryListProps) {
  if (props.entries.length === 0) {
    return (
      <div className="emptyState">
        {props.mode === "leads" ? "No open leads without bookings right now." : "No client bookings recorded yet."}
      </div>
    );
  }

  return (
    <section className="listPanel directoryList">
      {props.mode === "leads"
        ? props.entries.map((entry) => {
            const displayName = getDisplayName(entry.contact);

            return (
              <div key={entry.contact.id} className="directoryRow">
                <div className="directoryMain">
                  <div className="directoryTop">
                    <Link href={`/contacts/${entry.contact.id}`} className="profilePrimaryLink">
                      {displayName}
                    </Link>
                    <StatusBadge status={entry.latestLead.status} />
                  </div>
                  <div className="directoryMeta">
                    <span>{entry.contact.email ?? "No email"}</span>
                    <span>{entry.contact.phone ?? "No phone"}</span>
                  </div>
                  <div className="directoryMeta">
                    <span>{entry.latestLead.service_requested ?? "General enquiry"}</span>
                    <span>{entry.latestLead.vehicle ? [entry.latestLead.vehicle.year, entry.latestLead.vehicle.make, entry.latestLead.vehicle.model].filter(Boolean).join(" ") : "Vehicle not linked"}</span>
                  </div>
                  <div className="directoryMeta">
                    <span>{entry.latestLead.source_detail ?? entry.latestLead.source}</span>
                    <span>{entry.leadCount} open {entry.leadCount === 1 ? "lead" : "leads"}</span>
                  </div>
                  <LeadStatusActions leadId={entry.latestLead.id} currentStatus={entry.latestLead.status} />
                </div>
                <div className="directoryAside">
                  <span>Last activity</span>
                  <strong>{formatDateTime(entry.latestLead.updated_at, props.timezone)}</strong>
                </div>
              </div>
            );
          })
        : props.entries.map((entry) => {
            const displayName = getDisplayName(entry.contact);

            return (
              <div key={entry.contact.id} className="directoryRow">
                <div className="directoryMain">
                  <div className="directoryTop">
                    <Link href={`/contacts/${entry.contact.id}`} className="profilePrimaryLink">
                      {displayName}
                    </Link>
                    <StatusBadge status={entry.latestBooking.status} />
                  </div>
                  <div className="directoryMeta">
                    <span>{entry.contact.email ?? "No email"}</span>
                    <span>{entry.contact.phone ?? "No phone"}</span>
                  </div>
                  <div className="directoryMeta">
                    <span>{entry.latestBooking.service_name}</span>
                    <span>{entry.latestBooking.vehicle ? [entry.latestBooking.vehicle.year, entry.latestBooking.vehicle.make, entry.latestBooking.vehicle.model].filter(Boolean).join(" ") : "Vehicle not linked"}</span>
                  </div>
                  <div className="directoryMeta">
                    <span>{entry.bookingCount} {entry.bookingCount === 1 ? "booking" : "bookings"}</span>
                    <span>Total est. revenue {formatCurrency(entry.totalRevenue)}</span>
                  </div>
                  <div className="directoryMeta">
                    <Link href={`/bookings/${entry.latestBooking.id}`} className="profileMetaLink">
                      Open latest booking
                    </Link>
                  </div>
                </div>
                <div className="directoryAside">
                  <span>Latest appointment</span>
                  <strong>{formatDateTime(entry.latestBooking.scheduled_start, props.timezone)}</strong>
                </div>
              </div>
            );
          })}
    </section>
  );
}
