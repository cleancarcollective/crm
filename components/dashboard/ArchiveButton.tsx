"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type ArchiveButtonProps = {
  type: "lead" | "contact";
  id: string;
  redirectAfter?: string;
};

export function ArchiveButton({ type, id, redirectAfter }: ArchiveButtonProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function handleArchive() {
    setError("");
    startTransition(async () => {
      const url = type === "lead"
        ? `/api/leads/${id}/archive`
        : `/api/contacts/${id}/archive`;
      const res = await fetch(url, { method: "POST" });
      if (res.ok) {
        if (redirectAfter) {
          window.location.href = redirectAfter;
        } else {
          router.refresh();
        }
      } else {
        setError("Failed to archive.");
        setConfirming(false);
      }
    });
  }

  if (confirming) {
    return (
      <span className="archiveConfirm">
        <span className="archiveConfirmText">Archive this {type}?</span>
        <button type="button" className="buttonDanger leadActionButton" onClick={handleArchive} disabled={isPending}>
          {isPending ? "Archiving…" : "Yes, archive"}
        </button>
        <button type="button" className="buttonGhost leadActionButton" onClick={() => setConfirming(false)}>
          Cancel
        </button>
        {error ? <span className="archiveError">{error}</span> : null}
      </span>
    );
  }

  return (
    <button type="button" className="buttonArchive" onClick={() => setConfirming(true)}>
      Archive
    </button>
  );
}
