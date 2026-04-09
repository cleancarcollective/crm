/**
 * Staff management API (protected — requires valid session cookie).
 *
 * POST /api/admin/staff  →  create a new staff account
 *   body: { email, name, password }
 *
 * GET  /api/admin/staff  →  list all staff accounts (no password hashes)
 */

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { hashPassword } from "@/lib/auth/password";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

async function getAuthenticatedUser() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;
  return verifySession(sessionId);
}

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorised." }, { status: 401 });

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("staff_users")
    .select("id, email, name, created_at")
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: "Failed to list staff." }, { status: 500 });
  return NextResponse.json({ staff: data });
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorised." }, { status: 401 });

  let body: { email?: string; name?: string; password?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  const name = body.name?.trim();
  const password = body.password ?? "";

  if (!email || !name || !password) {
    return NextResponse.json({ error: "email, name and password are required." }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const passwordHash = hashPassword(password);
  const supabase = getSupabaseAdminClient();

  const { data, error } = await supabase
    .from("staff_users")
    .insert({ email, name, password_hash: passwordHash })
    .select("id, email, name, created_at")
    .single();

  if (error) {
    const isDuplicate = error.code === "23505";
    return NextResponse.json(
      { error: isDuplicate ? "A staff account with that email already exists." : "Failed to create account." },
      { status: isDuplicate ? 409 : 500 }
    );
  }

  return NextResponse.json({ success: true, staff: data }, { status: 201 });
}
