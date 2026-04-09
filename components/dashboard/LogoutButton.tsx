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
    <button className="globalNavLogout" onClick={handleLogout} disabled={loading}>
      {loading ? "…" : "Sign out"}
    </button>
  );
}
