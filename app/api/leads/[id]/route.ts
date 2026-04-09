import { NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

const ALLOWED_LEAD_STATUSES = new Set(["new", "contacted", "quoted", "clicked", "booked", "lost"]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let payload: { status?: string };

  try {
    payload = (await request.json()) as { status?: string };
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON payload." }, { status: 400 });
  }

  const status = payload.status?.trim().toLowerCase();
  if (!status || !ALLOWED_LEAD_STATUSES.has(status)) {
    return NextResponse.json({ success: false, error: "Invalid lead status." }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  const { data: currentLead, error: currentLeadError } = await supabase
    .from("leads")
    .select("id, status, booked_at")
    .eq("id", id)
    .maybeSingle();

  if (currentLeadError) {
    return NextResponse.json({ success: false, error: "Failed to load lead." }, { status: 500 });
  }

  if (!currentLead) {
    return NextResponse.json({ success: false, error: "Lead not found." }, { status: 404 });
  }

  const updatePayload: { status: string; booked_at?: string | null } = { status };

  if (status === "booked") {
    updatePayload.booked_at = currentLead.booked_at ?? new Date().toISOString();
  } else if (currentLead.status === "booked") {
    updatePayload.booked_at = null;
  }

  const { error } = await supabase
    .from("leads")
    .update(updatePayload)
    .eq("id", id);

  if (error) {
    return NextResponse.json({ success: false, error: "Failed to update lead." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
