"use client";

import { useMemo, useState } from "react";

import { MarkdownResourceEditor } from "@/components/dashboard/MarkdownResourceEditor";

export type SalesResource = {
  id: string;
  shop_id: string | null;
  slug: string;
  type: string;
  title: string;
  body_markdown: string;
  display_order: number | null;
  updated_at: string;
};

type Props = {
  resources: SalesResource[];
  canEdit: boolean;
};

const SECTION_ORDER: Array<{ type: string; label: string }> = [
  { type: "opener", label: "Openers" },
  { type: "objection-card", label: "Objection cards" },
  { type: "closing", label: "Closing" },
];

export function ObjectionsClient({ resources, canEdit }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const sections = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return SECTION_ORDER.map((s) => ({
      ...s,
      items: resources
        .filter((r) => r.type === s.type)
        .filter((r) => {
          if (!q) return true;
          return (
            r.title.toLowerCase().includes(q) ||
            r.body_markdown.toLowerCase().includes(q)
          );
        }),
    }));
  }, [resources, filter]);

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
            placeholder="e.g. price, forgot, region"
          />
        </label>
      </form>

      {sections.map((section) => (
        <section key={section.type} className="detailPanel" style={{ marginBottom: 16 }}>
          <h2>{section.label}</h2>
          {section.items.length === 0 ? (
            <p className="profileEmpty">No entries.</p>
          ) : (
            <div className="profileStack">
              {section.items.map((r) => (
                <div key={r.id} className="profileCard">
                  <div
                    className="profileCardTop"
                    style={{ cursor: "pointer" }}
                    onClick={() => setOpenId(openId === r.id ? null : r.id)}
                  >
                    <strong>{r.title}</strong>
                    <span style={{ color: "#9e9189", fontSize: 12 }}>
                      {openId === r.id ? "Hide" : "Show"}
                    </span>
                  </div>
                  {openId === r.id ? (
                    <div style={{ marginTop: 8 }}>
                      <MarkdownResourceEditor
                        resourceId={r.id}
                        initialTitle={r.title}
                        initialBody={r.body_markdown}
                        canEdit={canEdit}
                      />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
    </>
  );
}
