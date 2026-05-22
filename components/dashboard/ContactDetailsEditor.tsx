"use client";

/**
 * Inline editor for the core contact fields (name, email, phone).
 * Renders the same read-only layout the server component used; flips to
 * a form on "Edit". Saves via PATCH /api/contacts/[id].
 *
 * Email is lowercased server-side so it stays stable for matching.
 * full_name is recomputed server-side from first_name + last_name.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type ContactDetailsEditorProps = {
  contactId: string;
  initialFirstName: string | null;
  initialLastName: string | null;
  initialFullName: string | null;
  initialEmail: string | null;
  initialPhone: string | null;
  createdLabel: string;
  /** When false (sales role), hide the Edit button entirely.
   *  Server-side PATCH still rejects these fields - this is just UI polish. */
  canEditContactDetails: boolean;
};

export function ContactDetailsEditor({
  contactId,
  initialFirstName,
  initialLastName,
  initialFullName,
  initialEmail,
  initialPhone,
  createdLabel,
  canEditContactDetails,
}: ContactDetailsEditorProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState(initialFirstName ?? "");
  const [lastName, setLastName] = useState(initialLastName ?? "");
  const [email, setEmail] = useState(initialEmail ?? "");
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const displayName =
    initialFullName || [initialFirstName, initialLastName].filter(Boolean).join(" ") || "Unknown contact";

  function reset() {
    setFirstName(initialFirstName ?? "");
    setLastName(initialLastName ?? "");
    setEmail(initialEmail ?? "");
    setPhone(initialPhone ?? "");
    setError("");
  }

  function handleSave() {
    setError("");
    startTransition(async () => {
      const res = await fetch(`/api/contacts/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: firstName,
          last_name: lastName,
          email,
          phone,
        }),
      });
      if (res.ok) {
        setEditing(false);
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "Failed to save.");
      }
    });
  }

  return (
    <section className="detailPanel">
      <div className="contactNotesPanelHeader">
        <h2>Contact</h2>
        {!editing && canEditContactDetails && (
          <button type="button" className="contactNotesEditBtn" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <>
          <div className="contactEditGrid">
            <label className="contactEditField">
              <span>First name</span>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoFocus
              />
            </label>
            <label className="contactEditField">
              <span>Last name</span>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </label>
            <label className="contactEditField contactEditField--wide">
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="customer@example.com"
              />
            </label>
            <label className="contactEditField contactEditField--wide">
              <span>Phone</span>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="021 123 4567"
              />
            </label>
          </div>
          {error ? <p className="contactNotesError">{error}</p> : null}
          <div className="contactNotesActions">
            <button
              type="button"
              className="buttonPrimary leadActionButton"
              onClick={handleSave}
              disabled={isPending}
            >
              {isPending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className="buttonGhost leadActionButton"
              onClick={() => {
                reset();
                setEditing(false);
              }}
              disabled={isPending}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="detailItem">
            <span>Name</span>
            <strong>{displayName}</strong>
          </div>
          <div className="detailItem">
            <span>Email</span>
            <strong>{initialEmail ?? "—"}</strong>
          </div>
          <div className="detailItem">
            <span>Phone</span>
            <strong>{initialPhone ?? "—"}</strong>
          </div>
          <div className="detailItem">
            <span>Created</span>
            <strong>{createdLabel}</strong>
          </div>
        </>
      )}
    </section>
  );
}
