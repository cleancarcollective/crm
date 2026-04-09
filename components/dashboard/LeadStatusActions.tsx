"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type LeadStatusActionsProps = {
  leadId: string;
  currentStatus: string;
};

const ACTIONS = [
  { label: "Mark New", status: "new", variant: "ghost" },
  { label: "Contacted", status: "contacted", variant: "primary" },
  { label: "Quoted", status: "quoted", variant: "primary" },
  { label: "Clicked", status: "clicked", variant: "primary" },
  { label: "Lost", status: "lost", variant: "danger" },
];

export function LeadStatusActions({ leadId, currentStatus }: LeadStatusActionsProps) {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);

  function handleUpdate(status: string) {
    setErrorMessage("");
    setPendingStatus(status);

    startTransition(async () => {
      const response = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });

      if (!response.ok) {
        setErrorMessage("Could not update lead.");
        setPendingStatus(null);
        return;
      }

      setPendingStatus(null);
      router.refresh();
    });
  }

  return (
    <div className="leadActionBlock">
      <div className="leadActionRow">
        {ACTIONS.filter((action) => action.status !== currentStatus).map((action) => (
          <button
            key={action.status}
            type="button"
            className={action.variant === "ghost" ? "buttonGhost leadActionButton" : action.variant === "danger" ? "buttonDanger leadActionButton" : "buttonPrimary leadActionButton"}
            onClick={() => handleUpdate(action.status)}
            disabled={isPending}
          >
            {isPending && pendingStatus === action.status ? "Saving…" : action.label}
          </button>
        ))}
      </div>
      {errorMessage ? <p className="leadActionError">{errorMessage}</p> : null}
    </div>
  );
}
