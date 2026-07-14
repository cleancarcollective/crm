/**
 * PATCH { first_name?, last_name?, phone? } - customer edits their own
 * details. Applied to every contact row for the session email (both
 * shops) so staff see the same numbers everywhere. Email itself is the
 * verified identity and cannot be changed here.
 */

import { NextRequest, NextResponse } from "next/server";

import { getPortalContacts, getPortalSession } from "@/lib/portal/session";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export async function PATCH(req: NextRequest) {
  const session = await getPortalSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: { first_name?: string; last_name?: string; phone?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const patch: Record<string, string> = {};
  if (typeof body.first_name === "string" && body.first_name.trim()) patch.first_name = body.first_name.trim().slice(0, 60);
  if (typeof body.last_name === "string") patch.last_name = body.last_name.trim().slice(0, 60);
  if (typeof body.phone === "string") patch.phone = body.phone.trim().slice(0, 30);
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }
  if (patch.first_name || patch.last_name !== undefined) {
    // Keep full_name coherent for CRM displays.
    const contacts = await getPortalContacts(session.email);
    const first = patch.first_name ?? contacts[0]?.first_name ?? "";
    const last = patch.last_name ?? contacts[0]?.last_name ?? "";
    patch.full_name = [first, last].filter(Boolean).join(" ");
  }

  const contacts = await getPortalContacts(session.email);
  if (contacts.length === 0) return NextResponse.json({ error: "No account" }, { status: 404 });

  const supabase = getSupabaseAdminClient();
  await supabase
    .from("contacts")
    .update(patch)
    .in("id", contacts.map((c) => c.id));

  return NextResponse.json({ ok: true });
}
