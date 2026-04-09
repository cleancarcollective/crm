import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { status, won_source } = body as { status?: string; won_source?: string };

  if (!status) {
    return NextResponse.json({ error: "status required" }, { status: 400 });
  }

  const VALID_STATUSES = ["new", "contacted", "quoted", "clicked", "won", "lost"];
  if (!VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();

  const updates: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };

  if (status === "won") {
    updates.won_source = won_source ?? null;
    updates.booked_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from("leads")
    .update(updates)
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) {
    console.error("PATCH lead error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ lead: data });
}
