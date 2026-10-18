"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function GiveawayDrawButton({ alreadyDrawn }: { alreadyDrawn: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState("");

  function draw() {
    const ok = window.confirm(
      alreadyDrawn
        ? "A draw already exists. Drawing again REPLACES the current winners. Continue?"
        : "Draw 1 grand prize winner, 10 runners-up and 3 reserves now? Chances are weighted by tickets (1 + friends referred). If the grand prize winner came in through a friend's link, that friend wins a grand prize too. Only do this once entries have closed."
    );
    if (!ok) return;
    setMsg("");
    startTransition(async () => {
      const res = await fetch("/api/giveaway/draw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redraw: alreadyDrawn }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMsg(`Drawn from ${data.drawn_from} entries (${data.tickets_total} tickets).`);
        router.refresh();
      } else {
        setMsg(data?.error ?? "Draw failed.");
      }
    });
  }

  return (
    <div style={{ textAlign: "right" }}>
      <button type="button" className="buttonPrimary" onClick={draw} disabled={isPending}>
        {isPending ? "Drawing…" : alreadyDrawn ? "Redraw winners" : "Draw winners"}
      </button>
      {msg ? <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>{msg}</p> : null}
    </div>
  );
}
