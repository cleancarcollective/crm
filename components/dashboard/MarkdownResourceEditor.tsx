"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { renderSimpleMarkdown } from "@/lib/markdown/renderSimple";

type MarkdownResourceEditorProps = {
  resourceId: string;
  initialTitle: string;
  initialBody: string;
  canEdit: boolean;
  /** When true, shows the title field. Default false (body-only edit). */
  editableTitle?: boolean;
  /** Optional last-updated suffix line shown above the rendered body. */
  metaLine?: string | null;
};

export function MarkdownResourceEditor({
  resourceId,
  initialTitle,
  initialBody,
  canEdit,
  editableTitle = false,
  metaLine,
}: MarkdownResourceEditorProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    setError("");
    startTransition(async () => {
      const payload: Record<string, unknown> = { body_markdown: body };
      if (editableTitle) payload.title = title;
      const res = await fetch(`/api/sales-resources/${resourceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setError("Could not save.");
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  if (!editing) {
    return (
      <div className="markdownResource">
        {metaLine ? <p className="markdownResourceMeta">{metaLine}</p> : null}
        <div
          className="markdownBody"
          dangerouslySetInnerHTML={{ __html: renderSimpleMarkdown(initialBody) }}
        />
        {canEdit ? (
          <button
            type="button"
            className="buttonGhost"
            onClick={() => {
              setTitle(initialTitle);
              setBody(initialBody);
              setEditing(true);
            }}
          >
            Edit
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="markdownResourceEditor">
      {editableTitle ? (
        <label className="modalField">
          <span>Title</span>
          <input
            className="detailInput"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
      ) : null}
      <label className="modalField">
        <span>Body (markdown)</span>
        <textarea
          className="detailInput"
          rows={16}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13 }}
        />
      </label>
      <div className="markdownPreviewBox">
        <p className="markdownPreviewLabel">Preview</p>
        <div
          className="markdownBody"
          dangerouslySetInnerHTML={{ __html: renderSimpleMarkdown(body) }}
        />
      </div>
      {error ? <p className="leadActionError">{error}</p> : null}
      <div className="markdownEditorActions">
        <button type="button" className="buttonGhost" onClick={() => setEditing(false)} disabled={isPending}>
          Cancel
        </button>
        <button type="button" className="buttonPrimary" onClick={handleSave} disabled={isPending}>
          {isPending ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
