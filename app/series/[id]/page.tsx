import Link from "next/link";
import { notFound } from "next/navigation";

import { SeriesActions } from "@/components/dashboard/SeriesActions";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { requireCurrentShop } from "@/lib/auth/currentShop";
import { getSeriesById } from "@/lib/dashboard/series";
import { formatCurrency, formatDateTime } from "@/lib/dashboard/format";
import { buildCadenceLabel, buildEndLabel } from "@/lib/email/sendSeriesConfirmation";

function relativeAge(iso: string | null): string {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 0) return "in the future";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export default async function SeriesDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const currentShop = await requireCurrentShop();
  const detail = await getSeriesById(id, currentShop.id);

  if (!detail) {
    notFound();
  }

  const { series, shop, contact, occurrences, stats } = detail;
  const customerName =
    contact?.full_name ||
    [contact?.first_name, contact?.last_name].filter(Boolean).join(" ") ||
    "Unknown customer";

  const cadenceLabel = buildCadenceLabel({
    frequency: series.frequency,
    intervalCount: series.interval_count,
    firstOccurrenceIso: series.first_occurrence_at,
    timezone: series.timezone,
    nthWeekOfMonth: series.nth_week_of_month,
  });
  const endLabel = buildEndLabel({
    endType: series.end_type,
    endAfterN: series.end_after_n,
    endOnDate: series.end_on_date,
    timezone: series.timezone,
  });

  const isActive = series.status === "active";
  const isPaused = series.status === "paused";
  const isCancelled = series.status === "cancelled";

  // Status banner colors — green/amber/red, matching the booking-detail
  // banner styles in app/bookings/[id]/page.tsx.
  const banner = isCancelled
    ? { bg: "#fdecea", border: "#e6a8a0", text: "#7a2018" }
    : isPaused
      ? { bg: "#fef6e7", border: "#f0d68b", text: "#7a5a18" }
      : { bg: "#e8f5e9", border: "#a5d6a7", text: "#1b5e20" };

  const horizonLabel = series.generated_through_date
    ? formatDateTime(`${series.generated_through_date}T00:00:00Z`, series.timezone, "d MMM yyyy")
    : "—";

  const nowIso = new Date().toISOString();

  return (
    <main className="pageShell">
      <div className="pageTopbar">
        <div>
          <p className="eyebrow">Recurring series</p>
          <h1 className="pageTitle">{series.service_name}</h1>
          <p className="detailSubtitle">
            {customerName} · {cadenceLabel}
          </p>
        </div>
        <div className="topbarMeta">
          <Link href="/" className="textLink">
            Back to calendar
          </Link>
          {contact ? (
            <Link href={`/contacts/${contact.id}`} className="textLink">
              Open customer profile →
            </Link>
          ) : null}
        </div>
      </div>

      <div
        style={{
          margin: "0 0 16px 0",
          padding: "12px 16px",
          background: banner.bg,
          border: `1px solid ${banner.border}`,
          color: banner.text,
          borderRadius: 8,
          fontSize: 14,
          lineHeight: 1.5,
        }}
      >
        {isActive ? (
          <>
            <strong>Active.</strong> Calendar is topped up through {horizonLabel}. New
            occurrences will continue to be generated automatically.
          </>
        ) : null}
        {isPaused ? (
          <>
            <strong>Paused.</strong> Calendar topped up through {horizonLabel}. New
            occurrences will NOT be added until you resume. Existing future
            occurrences remain on the calendar.
          </>
        ) : null}
        {isCancelled ? (
          <>
            <strong>Cancelled.</strong> Future occurrences were cancelled. Past
            occurrences are kept here for history.
          </>
        ) : null}
      </div>

      <div className="summaryStrip">
        <div className="summaryCard">
          <span>Total</span>
          <strong>{stats.total}</strong>
        </div>
        <div className="summaryCard">
          <span>Completed</span>
          <strong>{stats.completed}</strong>
        </div>
        <div className="summaryCard">
          <span>Upcoming</span>
          <strong>{stats.upcoming}</strong>
        </div>
        <div className="summaryCard">
          <span>Cancelled</span>
          <strong>{stats.cancelled}</strong>
        </div>
        <div className="summaryCard">
          <span>Lifetime revenue</span>
          <strong>{formatCurrency(stats.lifetimeRevenue)}</strong>
        </div>
      </div>

      <section className="detailPanel">
        <h2>Actions</h2>
        <SeriesActions series={series} />
      </section>

      <section className="detailPanel">
        <h2>Series details</h2>
        <div className="profileStack">
          <div className="profileCard">
            <span><strong>Cadence:</strong> {cadenceLabel}</span>
            <span><strong>End condition:</strong> {endLabel}</span>
            <span>
              <strong>First occurrence:</strong>{" "}
              {formatDateTime(series.first_occurrence_at, shop.timezone, "EEE d MMM yyyy, h:mm a")}
            </span>
            <span><strong>Horizon (generated through):</strong> {horizonLabel}</span>
            <span>
              <strong>Last regen:</strong>{" "}
              {series.last_regen_at
                ? `${formatDateTime(series.last_regen_at, shop.timezone, "EEE d MMM yyyy, h:mm a")} (${relativeAge(series.last_regen_at)})`
                : "—"}
            </span>
            {series.last_regen_error ? (
              <span style={{ color: "#c0392b" }}>
                <strong>Last regen error:</strong> {series.last_regen_error}
              </span>
            ) : null}
            <span><strong>Created by:</strong> {series.created_by_user_id ?? "—"}</span>
            <span>
              <strong>Created at:</strong>{" "}
              {formatDateTime(series.created_at, shop.timezone, "EEE d MMM yyyy, h:mm a")}
            </span>
            {stats.overridden > 0 ? (
              <span>
                <strong>Overridden occurrences:</strong> {stats.overridden} (modified individually, not affected by series edits)
              </span>
            ) : null}
          </div>
        </div>
      </section>

      <section className="detailPanel">
        <h2>Occurrences ({occurrences.length})</h2>
        {occurrences.length === 0 ? (
          <p className="profileEmpty">No occurrences generated yet.</p>
        ) : (
          <div className="profileStack">
            {occurrences.map((b, idx) => {
              const isPast = b.scheduled_start < nowIso;
              const isCancelledRow = b.status === "cancelled";
              const isCompletedRow = b.status === "completed";
              const reschedulePending = (b.notes ?? "").includes("[Reschedule requested]");

              const cardStyle: React.CSSProperties = {};
              if (isCancelledRow) {
                cardStyle.background = "#fdecea";
                cardStyle.borderColor = "#e6a8a0";
              } else if (isPast && isCompletedRow) {
                cardStyle.opacity = 0.6;
              }
              if (reschedulePending) {
                cardStyle.borderLeft = "3px solid #f0a020";
              }

              const textStyle: React.CSSProperties = isCancelledRow
                ? { textDecoration: "line-through", color: "#7a2018" }
                : {};

              return (
                <Link
                  key={b.id}
                  href={`/bookings/${b.id}`}
                  className="profileCard"
                  style={{ textDecoration: "none", color: "inherit", ...cardStyle }}
                >
                  <div className="profileCardTop">
                    <strong style={textStyle}>
                      #{(b.series_sequence ?? idx) + 1} ·{" "}
                      {formatDateTime(b.scheduled_start, shop.timezone, "EEE d MMM yyyy, h:mm a")}
                    </strong>
                    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {reschedulePending ? (
                        <span title="Reschedule requested" style={{ color: "#b47318" }}>🔄</span>
                      ) : null}
                      {b.series_overridden ? (
                        <span
                          style={{
                            fontSize: 11,
                            padding: "2px 6px",
                            background: "#eef2f7",
                            border: "1px solid #c9d4e0",
                            borderRadius: 4,
                            color: "#3a4a5c",
                          }}
                          title="This occurrence was edited individually"
                        >
                          ✎ modified
                        </span>
                      ) : null}
                      <StatusBadge status={b.status} />
                    </span>
                  </div>
                  <span style={textStyle}>{formatCurrency(b.price_estimate)}</span>
                  {b.notes ? (
                    <span style={{ fontSize: 12, color: "#7a6f68" }}>{b.notes}</span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
