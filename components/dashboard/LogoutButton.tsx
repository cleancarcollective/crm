"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
    router.refresh();
  }

  return (
    <button className="globalNavLogout" onClick={handleLogout} disabled={loading} aria-label="Sign out" title="Sign out">
      <span className="globalNavLogoutText">{loading ? "…" : "Sign out"}</span>
      <svg className="globalNavLogoutIcon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M6 2H3.5A1.5 1.5 0 0 0 2 3.5v9A1.5 1.5 0 0 0 3.5 14H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M10 11l3-3-3-3M13 8H6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
