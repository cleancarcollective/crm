import Link from "next/link";

import { BookingDetail } from "@/components/dashboard/BookingDetail";
import { requireCurrentShop } from "@/lib/auth/currentShop";
import { getBookingById } from "@/lib/dashboard/bookings";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export default async function BookingDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const currentShop = await requireCurrentShop();
  const { shop, booking } = await getBookingById(id, currentShop.slug);

  // Look up the parent series status so the banner can surface "cancelled"
  // and the detail component can disable series-scoped actions.
  let seriesStatus: string | null = null;
  if (booking.series_id) {
    const supabase = getSupabaseAdminClient();
    const { data } = await supabase
      .from("booking_series")
      .select("status")
      .eq("id", booking.series_id)
      .eq("shop_id", currentShop.id)
      .maybeSingle();
    seriesStatus = (data?.status as string | undefined) ?? null;
  }

  const seriesCancelled = seriesStatus === "cancelled";

  return (
    <main className="pageShell">
      <div className="pageTopbar">
        <div>
          <Link href="/" className="textLink">
            Back to calendar
          </Link>
        </div>
      </div>

      {booking.series_id ? (
        <div
          style={{
            margin: "0 0 16px 0",
            padding: "10px 14px",
            background: seriesCancelled ? "#fdecea" : "#fef6e7",
            border: `1px solid ${seriesCancelled ? "#e6a8a0" : "#f0d68b"}`,
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            fontSize: 14,
            flexWrap: "wrap",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span>
              ↻ Part of a recurring series
              {booking.series_sequence !== null ? ` — occurrence #${(booking.series_sequence ?? 0) + 1}` : ""}
            </span>
            {seriesCancelled ? (
              <span
                style={{
                  background: "#c0392b",
                  color: "#fff",
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  padding: "3px 8px",
                  borderRadius: 4,
                }}
              >
                Series cancelled
              </span>
            ) : null}
          </span>
          {/* /series/[id] page does not exist yet (step 5 of the build).
              Cast through unknown because typed routes won't recognise it. */}
          <Link href={(`/series/${booking.series_id}` as unknown) as never} className="textLink">
            View series →
          </Link>
        </div>
      ) : null}

      <BookingDetail booking={booking} shop={shop} seriesStatus={seriesStatus} />
    </main>
  );
}
