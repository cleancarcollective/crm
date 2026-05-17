"use client";

import { useState } from "react";

type Staff = {
  id: string;
  email: string;
  name: string;
  role: string;
  is_super_admin: boolean;
  created_at: string;
  isSelf: boolean;
};

type Props = {
  initialStaff: Staff[];
  shopSlug: string;
};

export function UsersAdmin({ initialStaff, shopSlug }: Props) {
  const [staff, setStaff] = useState(initialStaff);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Create form
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "contractor">("contractor");

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, password, role, shop_slug: shopSlug }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setStaff((prev) => [...prev, { ...data.staff, role: data.staff.role ?? role, is_super_admin: false, isSelf: false }]);
      setName(""); setEmail(""); setPassword(""); setRole("contractor");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRoleChange(id: string, newRole: "admin" | "contractor") {
    setError(null);
    const prev = staff;
    setStaff((p) => p.map((s) => (s.id === id ? { ...s, role: newRole } : s)));
    try {
      const res = await fetch(`/api/admin/staff/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      setStaff(prev); // rollback
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDelete(s: Staff) {
    if (!confirm(`Remove ${s.name} <${s.email}>? They lose access immediately.`)) return;
    setError(null);
    const prev = staff;
    setStaff((p) => p.filter((x) => x.id !== s.id));
    try {
      const res = await fetch(`/api/admin/staff/${s.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      setStaff(prev);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <section className="detailPanel settingsSection">
        <h2>Add a user</h2>
        <p className="settingsDescription">
          Contractors can view bookings, leads, and customers but not access settings or analytics.
          Admins have full access including this page.
        </p>
        {error && <p className="editorError" role="alert">{error}</p>}
        <form onSubmit={handleCreate} className="staffCreateForm">
          <div className="modalRow2">
            <div className="modalField">
              <label>Name</label>
              <input className="detailInput" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jane Smith" required />
            </div>
            <div className="modalField">
              <label>Email</label>
              <input className="detailInput" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@cleancarcollective.co.nz" required />
            </div>
          </div>
          <div className="modalRow2">
            <div className="modalField">
              <label>Temporary password (≥ 8 chars)</label>
              <input className="detailInput" type="text" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} placeholder="Share securely with them after creation" required />
            </div>
            <div className="modalField">
              <label>Role</label>
              <select className="detailInput" value={role} onChange={(e) => setRole(e.target.value as "admin" | "contractor")}>
                <option value="contractor">Contractor (limited)</option>
                <option value="admin">Admin (full access)</option>
              </select>
            </div>
          </div>
          <button type="submit" className="buttonPrimary" disabled={busy}>
            {busy ? "Creating…" : "Create user"}
          </button>
        </form>
      </section>

      <section className="detailPanel settingsSection">
        <h2>Current users</h2>
        <table className="staffTable">
          <thead>
            <tr><th>Name</th><th>Email</th><th>Role</th><th>Created</th><th></th></tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id}>
                <td>
                  <strong>{s.name}</strong>
                  {s.isSelf ? <span className="staffSelfTag"> · you</span> : null}
                  {s.is_super_admin ? <span className="staffSelfTag"> · super</span> : null}
                </td>
                <td>{s.email}</td>
                <td>
                  <select
                    className="detailInput staffRoleSelect"
                    value={s.role}
                    onChange={(e) => handleRoleChange(s.id, e.target.value as "admin" | "contractor")}
                    disabled={s.isSelf}
                  >
                    <option value="contractor">Contractor</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
                <td>{new Date(s.created_at).toLocaleDateString("en-NZ")}</td>
                <td>
                  {!s.isSelf && (
                    <button className="buttonGhost buttonDanger" onClick={() => handleDelete(s)} type="button">
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
