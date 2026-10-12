"use client";

/**
 * Marketing SMS opt-out switch on the contact profile.
 *
 * Opting out cancels every pending marketing text for the contact and
 * stops future ones. Booking texts the customer triggered themselves
 * (reminder, car-ready, review request) still send. Saves via
 * PATCH /api/contacts/[id] { sms_opt_out, sms_opt_out_reason }.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Props = {
  contactId: string;
  initialOptOut: boolean;
  optOutAt: string | null;
  optOutReason: string | null;
};

export function SmsOptOutToggle({ contactId, initialOptOut, optOutAt, optOutReason }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function setOptOut(next: boolean) {
    setError("");
    const reason = next ? window.prompt("Why? (e.g. 'asked by email 10 Oct')", "Customer asked to stop marketing texts") : null;
    if (next && reason === null) return; // cancelled the prompt
    startTransition(async () => {
      const res = await fetch(`/api/contacts/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sms_opt_out: next, sms_opt_out_reason: reason ?? null }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "Failed to save.");
      }
    });
  }

  const when = optOutAt ? new Date(optOutAt).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" }) : null;

  return (
    <section className="detailPanel" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 15 }}>Marketing texts</h2>
          {initialOptOut ? (
            <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)" }}>
              <span style={{ background: "#fee2e2", color: "#991b1b", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, marginRight: 8 }}>
                OPTED OUT
              </span>
              No offer or follow-up texts will be sent.{when ? ` Since ${when}.` : ""}
              {optOutReason ? ` Reason: ${optOutReason}` : ""}
              <br />
              Booking reminders and pickup texts still send.
            </p>
          ) : (
            <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)" }}>
              This contact can receive offer and follow-up texts.
            </p>
          )}
          {error ? <p className="contactNotesError" style={{ marginTop: 8 }}>{error}</p> : null}
        </div>
        <button
          type="button"
          className={initialOptOut ? "buttonGhost leadActionButton" : "buttonPrimary leadActionButton"}
          onClick={() => setOptOut(!initialOptOut)}
          disabled={isPending}
        >
          {isPending ? "Saving…" : initialOptOut ? "Allow marketing texts" : "Stop marketing texts"}
        </button>
      </div>
    </section>
  );
}
