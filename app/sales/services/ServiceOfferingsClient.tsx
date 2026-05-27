"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { renderSimpleMarkdown } from "@/lib/markdown/renderSimple";

type PricingRow = { price?: number; price_from?: number; price_to?: number; duration_minutes?: number };

type ServiceOffering = {
  id: string;
  shop_id: string | null;
  service_id: string;
  display_name: string;
  category: string | null;
  popularity_rank: number | null;
  pricing_table: Record<string, PricingRow> | null;
  description: string | null;
  what_included: string | null;
  selling_points: string | null;
  notes: string | null;
  is_active: boolean;
  updated_at: string;
};

type Props = {
  offerings: ServiceOffering[];
  canEdit: boolean;
};

function priceLabel(row: PricingRow): string {
  if (typeof row.price === "number") return `$${row.price}`;
  if (typeof row.price_from === "number" && typeof row.price_to === "number") {
    return `$${row.price_from}-$${row.price_to}`;
  }
  if (typeof row.price_from === "number") return `from $${row.price_from}`;
  return "-";
}

function priceRange(o: ServiceOffering): string {
  if (!o.pricing_table) return "Quote on request";
  const rows = Object.values(o.pricing_table);
  const nums: number[] = [];
  for (const r of rows) {
    if (typeof r.price === "number") nums.push(r.price);
    if (typeof r.price_from === "number") nums.push(r.price_from);
    if (typeof r.price_to === "number") nums.push(r.price_to);
  }
  if (!nums.length) return "Quote on request";
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  return min === max ? `$${min}` : `$${min} - $${max}`;
}

export function ServiceOfferingsClient({ offerings, canEdit }: Props) {
  const [filter, setFilter] = useState("");
  const [category, setCategory] = useState<string>("All");
  const [expanded, setExpanded] = useState<string | null>(null);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const o of offerings) if (o.category) set.add(o.category);
    return ["All", ...Array.from(set).sort()];
  }, [offerings]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return offerings.filter((o) => {
      if (category !== "All" && o.category !== category) return false;
      if (!q) return true;
      return (
        o.display_name.toLowerCase().includes(q) ||
        (o.description ?? "").toLowerCase().includes(q) ||
        (o.what_included ?? "").toLowerCase().includes(q)
      );
    });
  }, [offerings, filter, category]);

  return (
    <>
      <form
        className="directoryFilterBar"
        onSubmit={(e) => e.preventDefault()}
        style={{ marginBottom: 12 }}
      >
        <label className="modalField">
          <span>Search</span>
          <input
            className="detailInput"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="e.g. ceramic, interior"
          />
        </label>
        <label className="modalField">
          <span>Category</span>
          <select
            className="detailInput"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
      </form>

      <div className="profileStack">
        {filtered.map((o) => (
          <ServiceCard
            key={o.id}
            offering={o}
            isExpanded={expanded === o.id}
            onToggle={() => setExpanded(expanded === o.id ? null : o.id)}
            canEdit={canEdit}
            priceRangeLabel={priceRange(o)}
          />
        ))}
        {filtered.length === 0 ? (
          <p className="profileEmpty">No services match.</p>
        ) : null}
      </div>
    </>
  );
}

type CardProps = {
  offering: ServiceOffering;
  isExpanded: boolean;
  onToggle: () => void;
  canEdit: boolean;
  priceRangeLabel: string;
};

function ServiceCard({ offering: o, isExpanded, onToggle, canEdit, priceRangeLabel }: CardProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState(o.description ?? "");
  const [whatIncluded, setWhatIncluded] = useState(o.what_included ?? "");
  const [sellingPoints, setSellingPoints] = useState(o.selling_points ?? "");
  const [notes, setNotes] = useState(o.notes ?? "");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    setError("");
    startTransition(async () => {
      const res = await fetch(`/api/service-offerings/${o.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description,
          what_included: whatIncluded,
          selling_points: sellingPoints,
          notes,
        }),
      });
      if (!res.ok) {
        setError("Could not save.");
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <div className="detailPanel" style={{ padding: 16 }}>
      <div className="profileCardTop" style={{ cursor: "pointer" }} onClick={onToggle}>
        <div>
          <strong style={{ fontSize: 16 }}>{o.display_name}</strong>
          {o.category ? (
            <span style={{ color: "#9e9189", marginLeft: 8, fontSize: 13 }}>{o.category}</span>
          ) : null}
        </div>
        <span style={{ color: "#1a7a3f", fontWeight: 600 }}>{priceRangeLabel}</span>
      </div>

      {!isExpanded ? (
        <p style={{ margin: "8px 0 0 0", color: "#5f534b" }}>{o.description ?? ""}</p>
      ) : null}

      {isExpanded && !editing ? (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
          {o.description ? (
            <p style={{ margin: 0 }}>{o.description}</p>
          ) : null}

          {o.what_included ? (
            <div>
              <h3 style={{ margin: "4px 0", fontSize: 14, color: "#5f534b" }}>What is included</h3>
              <div
                className="markdownBody"
                dangerouslySetInnerHTML={{ __html: renderSimpleMarkdown(o.what_included) }}
              />
            </div>
          ) : null}

          {o.selling_points ? (
            <div>
              <h3 style={{ margin: "4px 0", fontSize: 14, color: "#5f534b" }}>When to recommend</h3>
              <div
                className="markdownBody"
                dangerouslySetInnerHTML={{ __html: renderSimpleMarkdown(o.selling_points) }}
              />
            </div>
          ) : null}

          {o.notes ? (
            <div style={{ background: "#fdf1d9", padding: "8px 12px", borderRadius: 8 }}>
              <h3 style={{ margin: "0 0 4px 0", fontSize: 13, color: "#8a5a06" }}>Internal note</h3>
              <p style={{ margin: 0 }}>{o.notes}</p>
            </div>
          ) : null}

          {o.pricing_table ? <PricingTable table={o.pricing_table} /> : null}

          {canEdit ? (
            <div>
              <button type="button" className="buttonGhost" onClick={() => setEditing(true)}>
                Edit copy
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {isExpanded && editing ? (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          <label className="modalField">
            <span>Description</span>
            <textarea
              className="detailInput"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label className="modalField">
            <span>What is included (markdown)</span>
            <textarea
              className="detailInput"
              rows={5}
              value={whatIncluded}
              onChange={(e) => setWhatIncluded(e.target.value)}
              style={{ fontFamily: "ui-monospace, monospace", fontSize: 13 }}
            />
          </label>
          <label className="modalField">
            <span>When to recommend (markdown)</span>
            <textarea
              className="detailInput"
              rows={5}
              value={sellingPoints}
              onChange={(e) => setSellingPoints(e.target.value)}
              style={{ fontFamily: "ui-monospace, monospace", fontSize: 13 }}
            />
          </label>
          <label className="modalField">
            <span>Internal notes</span>
            <textarea
              className="detailInput"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          {error ? <p className="leadActionError">{error}</p> : null}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="buttonGhost" onClick={() => setEditing(false)} disabled={isPending}>
              Cancel
            </button>
            <button type="button" className="buttonPrimary" onClick={handleSave} disabled={isPending}>
              {isPending ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PricingTable({ table }: { table: Record<string, PricingRow> }) {
  const entries = Object.entries(table);
  if (!entries.length) return null;
  return (
    <div>
      <h3 style={{ margin: "4px 0", fontSize: 14, color: "#5f534b" }}>Pricing</h3>
      <table className="staffTable" style={{ fontSize: 13 }}>
        <thead>
          <tr>
            <th>Vehicle / tier</th>
            <th>Price</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([label, row]) => (
            <tr key={label}>
              <td>{label}</td>
              <td>{priceLabel(row)}</td>
              <td>{row.duration_minutes ? `${row.duration_minutes} min` : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
