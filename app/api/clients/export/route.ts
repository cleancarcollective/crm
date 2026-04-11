import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";

  const supabase = getSupabaseAdminClient();
  const { data: contacts, error } = await supabase
    .from("contacts")
    .select("id, full_name, first_name, last_name, email, phone, created_at")
    .not("archived", "eq", true)
    .order("updated_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: bookings } = await supabase
    .from("bookings")
    .select("contact_id, status, price_estimate, service_name, scheduled_start");

  const bookingsByContact = new Map<string, Record<string, unknown>[]>();
  for (const b of bookings ?? []) {
    const arr = bookingsByContact.get(String(b.contact_id)) ?? [];
    arr.push(b as Record<string, unknown>);
    bookingsByContact.set(String(b.contact_id), arr);
  }

  let rows = (contacts ?? []).filter((c) => (bookingsByContact.get(c.id) ?? []).length > 0);

  if (q) {
    const qLower = q.toLowerCase();
    rows = rows.filter((c) =>
      [c.full_name, c.email, c.phone].filter(Boolean).join(" ").toLowerCase().includes(qLower)
    );
  }

  const csvRows = [
    ["Name", "Email", "Phone", "Bookings", "Total Spend (ex GST)", "Last Booking", "Created"],
    ...rows.map((c) => {
      const bks = bookingsByContact.get(c.id) ?? [];
      const total = bks.reduce((sum, b) => sum + (Number(b.price_estimate) || 0), 0);
      const sorted = [...bks].sort((a, b) => String(b.scheduled_start ?? "").localeCompare(String(a.scheduled_start ?? "")));
      const last = sorted[0];
      return [
        c.full_name || [c.first_name, c.last_name].filter(Boolean).join(" ") || "",
        c.email ?? "",
        c.phone ?? "",
        bks.length,
        total.toFixed(2),
        last?.scheduled_start ? new Date(String(last.scheduled_start)).toLocaleDateString("en-NZ") : "",
        c.created_at ? new Date(c.created_at).toLocaleDateString("en-NZ") : "",
      ];
    }),
  ];

  const csv = csvRows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="clients-${new Date().toISOString().slice(0,10)}.csv"`,
    },
  });
}
