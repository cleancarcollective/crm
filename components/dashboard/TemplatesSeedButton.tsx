"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function TemplatesSeedButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState("");

  function handleSeed() {
    setMsg("");
    startTransition(async () => {
      const res = await fetch("/api/settings/templates/seed", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMsg(`Seeded ${data.inserted ?? 0} templates.`);
        router.refresh();
      } else {
        setMsg(`Failed: ${data.error ?? "unknown error"}`);
      }
    });
  }

  return (
    <div className="templatesSeedRow">
      <button
        type="button"
        onClick={handleSeed}
        disabled={isPending}
        className="buttonPrimary"
      >
        {isPending ? "Seeding…" : "Seed default templates"}
      </button>
      {msg ? <span className="settingsSaveMsg">{msg}</span> : null}
    </div>
  );
}
