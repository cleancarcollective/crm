/**
 * POST /api/account/change-password
 * Body: { current_password, new_password }
 *
 * Lets a logged-in staff member change their own password. The current
 * password is verified first to prevent session-hijack abuse.
 */

import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/currentShop";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  let body: { current_password?: string; new_password?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const current = body.current_password ?? "";
  const next = body.new_password ?? "";

  if (!current || !next) {
    return NextResponse.json({ error: "current_password and new_password are required" }, { status: 400 });
  }
  if (next.length < 8) {
    return NextResponse.json({ error: "New password must be at least 8 characters" }, { status: 400 });
  }
  if (current === next) {
    return NextResponse.json({ error: "New password must be different from current" }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  const { data: row } = await supabase
    .from("staff_users")
    .select("id, password_hash")
    .eq("id", user.userId)
    .maybeSingle();

  if (!row) return NextResponse.json({ error: "User not found" }, { status: 404 });

  if (!verifyPassword(current, row.password_hash as string)) {
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
  }

  const newHash = hashPassword(next);
  const { error } = await supabase
    .from("staff_users")
    .update({ password_hash: newHash })
    .eq("id", user.userId);

  if (error) return NextResponse.json({ error: "Failed to update password" }, { status: 500 });

  return NextResponse.json({ ok: true });
}
