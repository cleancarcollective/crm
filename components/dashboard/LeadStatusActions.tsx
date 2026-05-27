"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type LeadStatusActionsProps = {
  leadId: string;
  currentStatus: string;
  wonSource?: string | null;
  /** When true, hide the booked button (already booked). */
  hasBooking?: boolean;
};

const WIN_SOURCES = [
  "Phone call",
  "Email",
  "Walk-in",
  "Referral",
  "Website",
  "Social media",
  "Other",
];

const PIPELINE_ACTIONS = [
  { label: "New", status: "new" },
  { label: "Contacted", status: "contacted" },
  { label: "Quoted", status: "quoted" },
];

export function LeadStatusActions({ leadId, currentStatus, wonSource, hasBooking }: LeadStatusActionsProps) {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [showWonPicker, setShowWonPicker] = useState(false);
  const [selectedWonSource, setSelectedWonSource] = useState("");
  const [pendingQuick, setPendingQuick] = useState<string | null>(null);

  /**
   * Quick-action handler: sets status + drops an auto-note in one go. Used by
   * the Called / Callback / Booked / Not interested pill buttons. Uses two
   * PATCH calls because the API doesn't combine status+notes (notes path
   * skips lead_notes_log entry when status is also set).
   */
  function handleQuickAction(action: "called" | "callback" | "booked" | "not_interested") {
    setErrorMessage("");
    setPendingQuick(action);

    startTransition(async () => {
      const now = new Date();
      const stamp = now.toLocaleString("en-NZ", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });

      const noteText =
        action === "called"
          ? `Called ${stamp}`
          : action === "callback"
          ? `Callback requested ${stamp}`
          : action === "booked"
          ? `Booked ${stamp}`
          : `Not interested ${stamp}`;

      const status =
        action === "called" ? "contacted"
        : action === "callback" ? "contacted"
        : action === "booked" ? "won"
        : "lost";

      try {
        // 1. Status flip (no note in this call - sales-stats counts notes only)
        const statusResp = await fetch(`/api/leads/${leadId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
        if (!statusResp.ok) throw new Error("status update failed");

        // 2. Append the auto-note (lands in lead_notes_log + leads.notes)
        const notesResp = await fetch(`/api/leads/${leadId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes: noteText }),
        });
        if (!notesResp.ok) throw new Error("notes update failed");
      } catch {
        setErrorMessage("Could not update lead.");
        setPendingQuick(null);
        return;
      }

      setPendingQuick(null);
      router.refresh();
    });
  }

  const quickActionsRow = (
    <div className="leadQuickActions">
      <button
        type="button"
        className="leadQuickPill leadQuickPill--called"
        onClick={() => handleQuickAction("called")}
        disabled={isPending}
      >
        {pendingQuick === "called" ? "Saving..." : "Called"}
      </button>
      <button
        type="button"
        className="leadQuickPill leadQuickPill--callback"
        onClick={() => handleQuickAction("callback")}
        disabled={isPending}
      >
        {pendingQuick === "callback" ? "Saving..." : "Callback"}
      </button>
      {!hasBooking ? (
        <button
          type="button"
          className="leadQuickPill leadQuickPill--booked"
          onClick={() => handleQuickAction("booked")}
          disabled={isPending}
        >
          {pendingQuick === "booked" ? "Saving..." : "Booked"}
        </button>
      ) : null}
      <button
        type="button"
        className="leadQuickPill leadQuickPill--lost"
        onClick={() => handleQuickAction("not_interested")}
        disabled={isPending}
      >
        {pendingQuick === "not_interested" ? "Saving..." : "Not interested"}
      </button>
    </div>
  );

  function handleUpdate(status: string, won_source?: string) {
    setErrorMessage("");
    setPendingStatus(status);

    startTransition(async () => {
      const response = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, won_source }),
      });

      if (!response.ok) {
        setErrorMessage("Could not update lead.");
        setPendingStatus(null);
        return;
      }

      setPendingStatus(null);
      setShowWonPicker(false);
      setSelectedWonSource("");
      router.refresh();
    });
  }

  // Won leads: show won source info + option to reopen
  if (currentStatus === "won") {
    return (
      <div className="leadActionBlock">
        <div className="leadActionRow">
          {wonSource ? (
            <span className="leadWonSource">Won via {wonSource}</span>
          ) : null}
          <button
            type="button"
            className="buttonGhost leadActionButton"
            onClick={() => handleUpdate("new")}
            disabled={isPending}
          >
            {isPending ? "Saving…" : "Reopen"}
          </button>
        </div>
        {errorMessage ? <p className="leadActionError">{errorMessage}</p> : null}
      </div>
    );
  }

  // Lost leads: reopen only
  if (currentStatus === "lost") {
    return (
      <div className="leadActionBlock">
        <div className="leadActionRow">
          <button
            type="button"
            className="buttonGhost leadActionButton"
            onClick={() => handleUpdate("new")}
            disabled={isPending}
          >
            {isPending ? "Saving…" : "Reopen"}
          </button>
          <button
            type="button"
            className="buttonWon leadActionButton"
            onClick={() => setShowWonPicker(true)}
            disabled={isPending}
          >
            Mark Won
          </button>
        </div>
        {showWonPicker && (
          <div className="wonPicker">
            <p className="wonPickerLabel">How did we win this?</p>
            <div className="wonPickerOptions">
              {WIN_SOURCES.map((src) => (
                <button
                  key={src}
                  type="button"
                  className={`wonPickerOption${selectedWonSource === src ? " wonPickerOptionSelected" : ""}`}
                  onClick={() => setSelectedWonSource(src)}
                >
                  {src}
                </button>
              ))}
            </div>
            <div className="wonPickerActions">
              <button
                type="button"
                className="buttonGhost leadActionButton"
                onClick={() => { setShowWonPicker(false); setSelectedWonSource(""); }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="buttonWon leadActionButton"
                onClick={() => handleUpdate("won", selectedWonSource || undefined)}
                disabled={isPending}
              >
                {isPending && pendingStatus === "won" ? "Saving…" : "Confirm Won"}
              </button>
            </div>
          </div>
        )}
        {errorMessage ? <p className="leadActionError">{errorMessage}</p> : null}
      </div>
    );
  }

  // Open leads: pipeline buttons + Mark Won + Lost
  return (
    <div className="leadActionBlock">
      {quickActionsRow}
      <div className="leadActionRow">
        {PIPELINE_ACTIONS.filter((a) => a.status !== currentStatus).map((action) => (
          <button
            key={action.status}
            type="button"
            className="buttonGhost leadActionButton"
            onClick={() => handleUpdate(action.status)}
            disabled={isPending}
          >
            {isPending && pendingStatus === action.status ? "Saving…" : action.label}
          </button>
        ))}
        <button
          type="button"
          className="buttonWon leadActionButton"
          onClick={() => setShowWonPicker(true)}
          disabled={isPending}
        >
          Mark Won
        </button>
        <button
          type="button"
          className="buttonDanger leadActionButton"
          onClick={() => handleUpdate("lost")}
          disabled={isPending}
        >
          {isPending && pendingStatus === "lost" ? "Saving…" : "Lost"}
        </button>
      </div>

      {showWonPicker && (
        <div className="wonPicker">
          <p className="wonPickerLabel">How did we win this?</p>
          <div className="wonPickerOptions">
            {WIN_SOURCES.map((src) => (
              <button
                key={src}
                type="button"
                className={`wonPickerOption${selectedWonSource === src ? " wonPickerOptionSelected" : ""}`}
                onClick={() => setSelectedWonSource(src)}
              >
                {src}
              </button>
            ))}
          </div>
          <div className="wonPickerActions">
            <button
              type="button"
              className="buttonGhost leadActionButton"
              onClick={() => { setShowWonPicker(false); setSelectedWonSource(""); }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="buttonWon leadActionButton"
              onClick={() => handleUpdate("won", selectedWonSource || undefined)}
              disabled={isPending}
            >
              {isPending && pendingStatus === "won" ? "Saving…" : "Confirm Won"}
            </button>
          </div>
        </div>
      )}
      {errorMessage ? <p className="leadActionError">{errorMessage}</p> : null}
    </div>
  );
}
