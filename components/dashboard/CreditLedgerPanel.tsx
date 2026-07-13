"use client";

import { useCallback, useEffect, useState } from "react";

type LedgerRow = {
  id: string;
  delta_cents: number;
  reason: string;
  created_by: string | null;
  created_at: string;
};

function fmtNzd(cents: number) {
  return new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(cents / 100);
}

/**
 * Admin-only prepaid-credit panel on the contact profile. Grants and
 * deductions write to credit_ledger; the customer sees the balance in
 * their portal account.
 */
export function CreditLedgerPanel({ contactId }: { contactId: string }) {
  const [balance, setBalance] = useState<number | null>(null);
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [forbidden, setForbidden] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/contacts/${contactId}/credits`);
    if (res.status === 403) {
      setForbidden(true);
      return;
    }
    if (!res.ok) return;
    const data = (await res.json()) as { balance_cents: number; rows: LedgerRow[] };
    setBalance(data.balance_cents);
    setRows(data.rows);
  }, [contactId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (forbidden) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/contacts/${contactId}/credits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delta_dollars: Number(amount), reason }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Failed");
      }
      setAmount("");
      setReason("");
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="detailPanel" style={{ marginTop: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <h2>Prepaid credit</h2>
        <strong style={{ fontSize: 18, color: (balance ?? 0) > 0 ? "var(--success)" : "var(--muted)" }}>
          {balance === null ? "…" : fmtNzd(balance)}
        </strong>
      </div>
      <p className="settingsDescription" style={{ marginTop: 2 }}>
        Balance shows in the customer&rsquo;s portal account. Deduct with a negative amount when
        credit is applied to a booking.
      </p>

      {showForm ? (
        <form onSubmit={submit} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginTop: 10 }}>
          <label className="portalField" style={{ marginTop: 0, width: 120 }}>
            <span>Amount ($)</span>
            <input
              className="portalInput"
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 150"
              required
            />
          </label>
          <label className="portalField" style={{ marginTop: 0, flex: 1, minWidth: 200 }}>
            <span>Reason</span>
            <input
              className="portalInput"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Prepaid 3-detail pack"
              required
            />
          </label>
          <button type="submit" className="buttonPrimary" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </button>
          <button type="button" className="buttonGhost" onClick={() => setShowForm(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <button type="button" className="buttonGhost" onClick={() => setShowForm(true)} style={{ marginTop: 8 }}>
          + Add credit entry
        </button>
      )}
      {error ? <p className="editorError">{error}</p> : null}

      {rows.length > 0 ? (
        <div style={{ marginTop: 14 }}>
          {rows.map((r) => (
            <div key={r.id} className="detailItem" style={{ padding: "8px 0" }}>
              <span style={{ fontSize: 13 }}>
                {r.reason}
                <span style={{ color: "var(--muted)" }}>
                  {" "}· {new Date(r.created_at).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" })}
                  {r.created_by ? ` · ${r.created_by}` : ""}
                </span>
              </span>
              <strong style={{ color: r.delta_cents >= 0 ? "var(--success)" : "var(--danger)" }}>
                {r.delta_cents >= 0 ? "+" : ""}{fmtNzd(r.delta_cents)}
              </strong>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
