"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type LeadEstimatePanelProps = {
  leadId: string;
  currentStatus: string;
  draftSubject: string | null;
  draftBody: string | null;
  internalNote: string | null;
  confidence: string | null;
  suggestedSize: string | null;
};

export function LeadEstimatePanel({
  leadId,
  currentStatus,
  draftSubject,
  draftBody,
  internalNote,
  confidence,
  suggestedSize,
}: LeadEstimatePanelProps) {
  const router = useRouter();
  const [subject, setSubject] = useState(draftSubject ?? "");
  const [body, setBody] = useState(draftBody ?? "");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Only show for leads needing approval
  if (currentStatus !== "needs_approval" && currentStatus !== "held") return null;

  function handleSend() {
    if (!subject.trim() || !body.trim()) {
      setError("Subject and body are required before sending.");
      return;
    }
    setError("");
    startTransition(async () => {
      const res = await fetch(`/api/leads/${leadId}/send-estimate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body }),
      });
      if (res.ok) {
        setSuccess(true);
        router.refresh();
      } else {
        const data = await res.json();
        setError(data.error ?? "Failed to send.");
      }
    });
  }

  if (success) {
    return (
      <div className="estimatePanelSent">
        ✓ Estimate sent successfully.
      </div>
    );
  }

  return (
    <div className="estimatePanel">
      <div className="estimatePanelHeader">
        <h3 className="estimatePanelTitle">Needs approval — estimate draft</h3>
        <div className="estimatePanelMeta">
          {internalNote ? <span className="estimatePanelNote">{internalNote}</span> : null}
          {confidence ? <span className="estimatePanelBadge">Confidence: {confidence}{suggestedSize ? ` · ${suggestedSize}` : ""}</span> : null}
        </div>
      </div>

      <div className="estimatePanelFields">
        <label className="estimatePanelLabel">
          Subject
          <input
            type="text"
            className="estimatePanelInput"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Email subject…"
          />
        </label>
        <label className="estimatePanelLabel">
          Body
          <textarea
            className="estimatePanelTextarea"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={18}
            placeholder="Email body…"
          />
        </label>
      </div>

      {error ? <p className="estimatePanelError">{error}</p> : null}

      <div className="estimatePanelActions">
        <button
          type="button"
          className="buttonPrimary"
          onClick={handleSend}
          disabled={isPending}
        >
          {isPending ? "Sending…" : "Send estimate email"}
        </button>
        <span className="estimatePanelHint">Sends exactly what you see above — edit freely before sending.</span>
      </div>
    </div>
  );
}
