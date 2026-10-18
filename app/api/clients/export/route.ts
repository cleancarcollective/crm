import { NextRequest, NextResponse } from "next/server";
import { getCurrentShop } from "@/lib/auth/currentShop";
import { fetchAllRows } from "@/lib/export/fetchAllRows";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";

  const shop = await getCurrentShop();
  if (!shop) return NextResponse.json({ error: "Unauthorised." }, { status: 401 });

  const supabase = getSupabaseAdminClient();

  type ContactRow = {
    id: string; full_name: string | null; first_name: string | null; last_name: string | null;
    email: string | null; phone: string | null; created_at: string | null;
  };
  type BookingRow = {
    contact_id: string | null; status: string | null; price_estimate: number | null;
    service_name: string | null; scheduled_start: string | null;
  };

  let contacts: ContactRow[];
  let bookings: BookingRow[];
  try {
    // Both tables are well over 1000 rows, so page through each in full.
    // Previously bookings were also capped, which dropped real clients
    // whose bookings fell outside the first 1000.
    [contacts, bookings] = await Promise.all([
      fetchAllRows<ContactRow>((from, to) =>
        supabase
          .from("contacts")
          .select("id, full_name, first_name, last_name, email, phone, created_at")
          .eq("shop_id", shop.id)
          .not("archived", "eq", true)
          .order("updated_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to)
      ),
      fetchAllRows<BookingRow>((from, to) =>
        supabase
          .from("bookings")
          .select("contact_id, status, price_estimate, service_name, scheduled_start")
          .eq("shop_id", shop.id)
          .order("id", { ascending: true })
          .range(from, to)
      ),
    ]);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  const bookingsByContact = new Map<string, Record<string, unknown>[]>();
  for (const b of bookings) {
    const arr = bookingsByContact.get(String(b.contact_id)) ?? [];
    arr.push(b as Record<string, unknown>);
    bookingsByContact.set(String(b.contact_id), arr);
  }

  let rows = contacts.filter((c) => (bookingsByContact.get(c.id) ?? []).length > 0);

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
