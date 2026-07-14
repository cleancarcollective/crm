/**
 * Shared CORS headers for portal endpoints called cross-origin by the
 * embedded booking forms. Open origin is safe here: these endpoints
 * carry no cookies, verify-before-PII is enforced server-side, and
 * unknown emails behave identically to known ones wherever possible.
 */

import { NextResponse } from "next/server";

export const PORTAL_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function corsJson(body: unknown, init?: { status?: number }) {
  return NextResponse.json(body, { status: init?.status ?? 200, headers: PORTAL_CORS_HEADERS });
}

export function corsPreflight() {
  return new NextResponse(null, { status: 204, headers: PORTAL_CORS_HEADERS });
}
