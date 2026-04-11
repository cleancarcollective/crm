"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type LeadNotesEditorProps = {
  leadId: string;
  initialNotes: string | null;
};

export function LeadNotesEditor({ leadId, initialNotes }: LeadNotesEditorProps) {
  const router = useRouter();
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function handleSave() {
    setError("");
    startTransition(async () => {
      const res = await fetch(`/api/leads/${leadId}`, {
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

  if (!editing) {
    return (
      <div className="leadNotesBlock">
        <div className="leadNotesView">
          <span className="leadNotesLabel">Notes</span>
          <p className="leadNotesText">{notes || <span className="leadNotesEmpty">No notes yet</span>}</p>
        </div>
        <button type="button" className="leadNotesEdit" onClick={() => setEditing(true)}>
          {notes ? "Edit notes" : "Add notes"}
        </button>
      </div>
    );
  }

  return (
    <div className="leadNotesBlock">
      <span className="leadNotesLabel">Notes</span>
      <textarea
        className="leadNotesTextarea"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={4}
        placeholder="Add notes about this lead…"
        autoFocus
      />
      {error ? <p className="leadNotesError">{error}</p> : null}
      <div className="leadNotesActions">
        <button type="button" className="buttonPrimary leadActionButton" onClick={handleSave} disabled={isPending}>
          {isPending ? "Saving…" : "Save notes"}
        </button>
        <button type="button" className="buttonGhost leadActionButton" onClick={() => { setEditing(false); setNotes(initialNotes ?? ""); }}>
          Cancel
        </button>
      </div>
    </div>
  );
}
