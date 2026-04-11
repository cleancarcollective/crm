"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type ContactNotesEditorProps = {
  contactId: string;
  initialNotes: string | null;
};

export function ContactNotesEditor({ contactId, initialNotes }: ContactNotesEditorProps) {
  const router = useRouter();
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function handleSave() {
    setError("");
    startTransition(async () => {
      const res = await fetch(`/api/contacts/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      if (res.ok) {
        setEditing(false);
        router.refresh();
      } else {
        setError("Failed to save notes.");
      }
    });
  }

  return (
    <section className="detailPanel contactNotesPanel">
      <div className="contactNotesPanelHeader">
        <h2>Notes</h2>
        {!editing && (
          <button type="button" className="contactNotesEditBtn" onClick={() => setEditing(true)}>
            {notes ? "Edit" : "Add note"}
          </button>
        )}
      </div>

      {editing ? (
        <>
          <textarea
            className="contactNotesTextarea"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={6}
            placeholder="Add notes about this contact — call outcomes, preferences, follow-up reminders…"
            autoFocus
          />
          {error ? <p className="contactNotesError">{error}</p> : null}
          <div className="contactNotesActions">
            <button type="button" className="buttonPrimary leadActionButton" onClick={handleSave} disabled={isPending}>
              {isPending ? "Saving…" : "Save"}
            </button>
            <button type="button" className="buttonGhost leadActionButton" onClick={() => { setEditing(false); setNotes(initialNotes ?? ""); }}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        notes
          ? <p className="contactNotesText">{notes}</p>
          : <p className="contactNotesEmpty">No notes yet. Add call outcomes, preferences, or follow-up reminders.</p>
      )}
    </section>
  );
}
