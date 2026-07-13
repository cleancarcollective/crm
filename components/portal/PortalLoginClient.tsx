"use client";

import { useState } from "react";

export function PortalLoginClient({ linkError }: { linkError: string | null }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(
    linkError === "expired"
      ? "That sign-in link has expired or was already used. Request a fresh one below."
      : linkError === "missing"
        ? "That link was missing its sign-in code. Request a fresh one below."
        : null
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/portal/auth/request-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Something went wrong");
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="portalShell portalShell--center">
      <div className="portalAuthCard">
        <p className="portalEyebrow">Clean Car Collective</p>
        <h1 className="portalAuthTitle">Your account</h1>

        {sent ? (
          <div className="portalAuthSent">
            <div className="portalAuthSentIcon">✉️</div>
            <h2>Check your email</h2>
            <p>
              If <strong>{email.trim()}</strong> has an account with us, a sign-in link is on its
              way. It works once and expires in 20 minutes.
            </p>
            <button type="button" className="portalLinkButton" onClick={() => setSent(false)}>
              Use a different email
            </button>
          </div>
        ) : (
          <>
            <p className="portalAuthSub">
              No passwords. Enter the email you book with and we&rsquo;ll send you a one-tap
              sign-in link.
            </p>
            <form onSubmit={submit} className="portalAuthForm">
              <label className="portalField">
                <span>Email</span>
                <input
                  type="email"
                  className="portalInput"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  autoFocus
                  required
                />
              </label>
              {error ? <p className="portalError">{error}</p> : null}
              <button type="submit" className="portalPrimaryBtn" disabled={pending}>
                {pending ? "Sending…" : "Email me a sign-in link"}
              </button>
            </form>
            <p className="portalAuthFoot">
              Booked with us before? Use the same email and your bookings, vehicles and reminders
              will be waiting.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
