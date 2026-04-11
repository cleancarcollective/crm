"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

const LEAD_SOURCES = [
  "Website",
  "Phone call",
  "Walk-in",
  "Referral",
  "Email",
  "Social media",
  "Google",
  "Facebook",
  "Instagram",
  "Other",
];

type LeadSourceEditorProps = {
  leadId: string;
  currentSource: string | null;
};

export function LeadSourceEditor({ leadId, currentSource }: LeadSourceEditorProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentSource ?? "");
  const [isPending, startTransition] = useTransition();

  function handleChange(newSource: string) {
    setValue(newSource);
    startTransition(async () => {
      await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: newSource }),
      });
      setEditing(false);
      router.refresh();
    });
  }

  if (editing) {
    return (
      <div className="leadSourceEditing">
        <select
          className="leadSourceSelect"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          disabled={isPending}
          autoFocus
        >
          <option value="">— Select source —</option>
          {LEAD_SOURCES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button type="button" className="leadSourceCancel" onClick={() => setEditing(false)}>✕</button>
      </div>
    );
  }

  return (
    <button type="button" className="leadSourceDisplay" onClick={() => setEditing(true)} title="Click to change source">
      <span className="leadSourceIcon">📥</span>
      <span>{value || "Set source"}</span>
      <span className="leadSourceEdit">edit</span>
    </button>
  );
}
