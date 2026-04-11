import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") ?? "";
  const q = searchParams.get("q") ?? "";

  const supabase = getSupabaseAdminClient();
  let query = supabase
    .from("leads")
    .select("id, status, won_source, service_requested, notes, source, source_detail, created_at, updated_at, contacts(full_name, first_name, last_name, email, phone), vehicles(year, make, model)")
    .not("archived", "eq", true)
    .order("updated_at", { ascending: false });

  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let rows = (data ?? []) as Record<string, unknown>[];

  if (q) {
    const qLower = q.toLowerCase();
    rows = rows.filter((row) => {
      const contact = row.contacts as Record<string, string> | null;
      const vehicle = row.vehicles as Record<string, string> | null;
      const haystack = [
        contact?.full_name, contact?.email, contact?.phone,
        row.service_requested, row.source, row.source_detail,
        vehicle?.make, vehicle?.model,
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(qLower);
    });
  }

  const csvRows = [
    ["Name", "Email", "Phone", "Vehicle", "Service", "Status", "Won Via", "Source", "Notes", "Created", "Updated"],
    ...rows.map((row) => {
      const c = row.contacts as Record<string, string> | null;
      const v = row.vehicles as Record<string, string> | null;
      return [
        c?.full_name || [c?.first_name, c?.last_name].filter(Boolean).join(" ") || "",
        c?.email ?? "",
        c?.phone ?? "",
        v ? [v.year, v.make, v.model].filter(Boolean).join(" ") : "",
        row.service_requested ?? "",
        row.status ?? "",
        row.won_source ?? "",
        String(row.source_detail || row.source || ""),
        row.notes ?? "",
        row.created_at ? new Date(String(row.created_at)).toLocaleDateString("en-NZ") : "",
        row.updated_at ? new Date(String(row.updated_at)).toLocaleDateString("en-NZ") : "",
      ];
    }),
  ];

  const csv = csvRows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="leads-${new Date().toISOString().slice(0,10)}.csv"`,
    },
  });
}
