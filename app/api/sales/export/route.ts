/**
 * CSV export of the sales-queue view. Admin-only — the route handler
 * enforces this regardless of UI hiding.
 */

import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/currentShop";
import { getSalesQueue, type SalesRange } from "@/lib/dashboard/salesLeads";

function csvEscape(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Admin role required." }, { status: 403 });

  const url = new URL(request.url);
  const rangeRaw = url.searchParams.get("range") ?? "all";
  const range: SalesRange = (["7-30d", "30-90d", "90-180d", "all"].includes(rangeRaw) ? rangeRaw : "all") as SalesRange;
  const service = url.searchParams.get("service") ?? undefined;
  const untouchedOnly = url.searchParams.get("untouched") === "1";

  const { entries } = await getSalesQueue({
    shopId: user.shop.id,
    range,
    service: service ?? undefined,
    untouchedOnly,
  });

  const header = [
    "lead_id",
    "name",
    "email",
    "phone",
    "vehicle",
    "service",
    "status",
    "days_since_enquiry",
    "created_at",
    "last_touched_at",
  ];
  const lines = [header.join(",")];
  for (const e of entries) {
    lines.push(
      [
        e.leadId,
        e.contactName,
        e.email,
        e.phone,
        e.vehicleLabel,
        e.serviceRequested,
        e.status,
        e.daysSinceEnquiry,
        e.createdAt,
        e.lastTouchedAt,
      ]
        .map(csvEscape)
        .join(",")
    );
  }

  return new NextResponse(lines.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="sales-queue-${range}.csv"`,
    },
  });
}
