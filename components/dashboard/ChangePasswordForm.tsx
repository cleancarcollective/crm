"use client";

import { useState, useTransition } from "react";

export function ChangePasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    if (next.length < 8) {
      setMsg({ type: "err", text: "New password must be at least 8 characters." });
      return;
    }
    if (next !== confirm) {
      setMsg({ type: "err", text: "Passwords don't match." });
      return;
    }
    if (current === next) {
      setMsg({ type: "err", text: "New password must be different from current." });
      return;
    }

    startTransition(async () => {
      const res = await fetch("/api/account/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: current, new_password: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMsg({ type: "ok", text: "Password changed." });
        setCurrent("");
        setNext("");
        setConfirm("");
      } else {
        setMsg({ type: "err", text: data.error ?? "Failed to change password." });
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="changePasswordForm">
      <label className="templateEditorField">
        <span className="templateEditorLabel">Current password</span>
        <input
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
          autoComplete="current-password"
          className="templateEditorInput"
        />
      </label>
      <label className="templateEditorField">
        <span className="templateEditorLabel">New password</span>
        <input
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
          autoComplete="new-password"
          minLength={8}
          className="templateEditorInput"
        />
      </label>
      <label className="templateEditorField">
        <span className="templateEditorLabel">Confirm new password</span>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          autoComplete="new-password"
          minLength={8}
          className="templateEditorInput"
        />
      </label>
      <div className="templateEditorActions">
        <button type="submit" className="buttonPrimary" disabled={isPending}>
          {isPending ? "Updating…" : "Update password"}
        </button>
        {msg ? (
          <span className={msg.type === "ok" ? "settingsSaveMsg" : "estimatePanelError"}>
            {msg.text}
          </span>
        ) : null}
      </div>
    </form>
  );
}
