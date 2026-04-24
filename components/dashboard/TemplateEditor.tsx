"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Template = {
  id: string;
  template_key: string;
  variant: string;
  name: string;
  subject: string;
  body_text: string;
  is_active: boolean;
  weight: number;
};

type Variable = { key: string; label: string };

type SiblingVariant = {
  id: string;
  variant: string;
  weight: number;
  is_active: boolean;
};

type TemplateEditorProps = {
  template: Template;
  variables: Variable[];
  siblings: SiblingVariant[]; // other variants of the same template_key
};

export function TemplateEditor({ template, variables, siblings }: TemplateEditorProps) {
  const router = useRouter();
  const [name, setName] = useState(template.name);
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body_text);
  const [isActive, setIsActive] = useState(template.is_active);
  const [weight, setWeight] = useState(template.weight);
  const [preview, setPreview] = useState<{ subject: string; body_text: string } | null>(null);
  const [saveMsg, setSaveMsg] = useState("");
  const [actionMsg, setActionMsg] = useState("");
  const [isPending, startTransition] = useTransition();

  // Live preview: debounce subject/body changes
  useEffect(() => {
    const handle = setTimeout(async () => {
      try {
        const res = await fetch("/api/settings/templates/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            template_key: template.template_key,
            subject,
            body_text: body,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setPreview({ subject: data.subject, body_text: data.body_text });
        }
      } catch {
        /* swallow preview errors — live preview is best-effort */
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [subject, body, template.template_key]);

  function handleSave() {
    setSaveMsg("");
    startTransition(async () => {
      const res = await fetch(`/api/settings/templates/${template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, subject, body_text: body, is_active: isActive, weight }),
      });
      if (res.ok) {
        setSaveMsg("Saved.");
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setSaveMsg(`Failed: ${data.error ?? "unknown error"}`);
      }
    });
  }

  function handleDuplicate() {
    setActionMsg("");
    startTransition(async () => {
      const res = await fetch(`/api/settings/templates/${template.id}/duplicate`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.template?.id) {
        setActionMsg("Variant created. Redirecting…");
        router.push(`/settings/templates/${data.template.id}` as never);
      } else {
        setActionMsg(`Failed: ${data.error ?? "unknown error"}`);
      }
    });
  }

  function handleDelete() {
    if (!confirm(`Delete variant ${template.variant}? This cannot be undone.`)) return;
    setActionMsg("");
    startTransition(async () => {
      const res = await fetch(`/api/settings/templates/${template.id}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        router.push("/settings/templates");
      } else {
        setActionMsg(`Failed: ${data.error ?? "unknown error"}`);
      }
    });
  }

  function insertVariable(varKey: string) {
    const token = `{{${varKey}}}`;
    const textarea = document.getElementById("template-body-textarea") as HTMLTextAreaElement | null;
    if (!textarea) {
      setBody((b) => b + token);
      return;
    }
    const start = textarea.selectionStart ?? body.length;
    const end = textarea.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    // restore caret after the inserted token on next tick
    requestAnimationFrame(() => {
      textarea.focus();
      const pos = start + token.length;
      textarea.setSelectionRange(pos, pos);
    });
  }

  return (
    <section className="detailPanel templateEditorPanel">
      <div className="templateEditorGrid">
        {/* LEFT: editor */}
        <div className="templateEditorCol">
          <label className="templateEditorField">
            <span className="templateEditorLabel">Template name (internal)</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="templateEditorInput"
            />
          </label>

          <label className="templateEditorField">
            <span className="templateEditorLabel">Subject line</span>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="templateEditorInput"
            />
          </label>

          <label className="templateEditorField">
            <span className="templateEditorLabel">Body (plain text)</span>
            <textarea
              id="template-body-textarea"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="templateEditorTextarea"
              rows={24}
              spellCheck={false}
            />
          </label>

          <div className="templateEditorToggleRow">
            <label className="templateEditorCheckboxLabel">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              <span>Active (auto-respond will use this template)</span>
            </label>
          </div>

          {/* Variant / A-B control */}
          <div className="templateVariantControlBox">
            <div className="templateVariantControlHeader">
              <h3 className="templateEditorSideHeading">Variant {template.variant}</h3>
              <span className="templateEditorSideHint">
                {siblings.length === 0
                  ? "This is the only variant for this template. Duplicate to start an A/B test."
                  : `Part of an A/B test — ${siblings.length + 1} total variants sharing traffic by weight.`}
              </span>
            </div>

            <label className="templateEditorField">
              <span className="templateEditorLabel">
                Traffic weight
                {siblings.length > 0 ? (
                  <span className="templateVariantSplitNote">
                    {" "}— current split: {computeSplit(template, siblings, weight)}
                  </span>
                ) : null}
              </span>
              <input
                type="number"
                min={0}
                max={1000}
                value={weight}
                onChange={(e) => setWeight(Math.max(0, parseInt(e.target.value) || 0))}
                className="templateEditorInput"
                style={{ maxWidth: 200 }}
              />
              <span className="templateEditorSideHint">
                Relative weight (0 = paused, higher = more traffic). The picker does a
                weighted random draw across all active variants.
              </span>
            </label>

            <div className="templateEditorActions" style={{ marginTop: 4 }}>
              <button type="button" onClick={handleDuplicate} disabled={isPending} className="buttonSecondary">
                {isPending ? "Working…" : `Duplicate as Variant ${nextVariantLetter(template, siblings)}`}
              </button>
              {siblings.length > 0 ? (
                <button type="button" onClick={handleDelete} disabled={isPending} className="buttonDanger">
                  Delete variant {template.variant}
                </button>
              ) : null}
              {actionMsg ? <span className="settingsSaveMsg">{actionMsg}</span> : null}
            </div>
          </div>

          <div className="templateEditorActions">
            <button
              type="button"
              onClick={handleSave}
              disabled={isPending}
              className="buttonPrimary"
            >
              {isPending ? "Saving…" : "Save changes"}
            </button>
            {saveMsg ? <span className="settingsSaveMsg">{saveMsg}</span> : null}
          </div>
        </div>

        {/* RIGHT: preview + variables */}
        <aside className="templateEditorSide">
          <div className="templateEditorVarsBox">
            <h3 className="templateEditorSideHeading">Available variables</h3>
            <p className="templateEditorSideHint">
              Click to insert at the cursor position.
            </p>
            <div className="templateEditorVarList">
              {variables.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  className="templateEditorVarChip"
                  onClick={() => insertVariable(v.key)}
                  title={v.label}
                >
                  {`{{${v.key}}}`}
                </button>
              ))}
            </div>
          </div>

          <div className="templateEditorPreviewBox">
            <h3 className="templateEditorSideHeading">Live preview</h3>
            <p className="templateEditorSideHint">
              Rendered using real pricing + sample lead (Alex / Toyota Corolla / Medium).
            </p>
            <div className="templatePreviewSubject">
              <span className="templatePreviewLabel">Subject:</span>
              <span>{preview?.subject ?? subject}</span>
            </div>
            <pre className="templatePreviewBody">{preview?.body_text ?? body}</pre>
          </div>
        </aside>
      </div>
    </section>
  );
}

const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];

function nextVariantLetter(current: Template, siblings: SiblingVariant[]): string {
  const taken = new Set([current.variant, ...siblings.map((s) => s.variant)]);
  return LETTERS.find((l) => !taken.has(l)) ?? "?";
}

function computeSplit(current: Template, siblings: SiblingVariant[], liveWeight: number): string {
  const all = [
    { variant: current.variant, weight: liveWeight, is_active: true },
    ...siblings.map((s) => ({ variant: s.variant, weight: s.weight, is_active: s.is_active })),
  ].filter((v) => v.is_active);

  const total = all.reduce((sum, v) => sum + v.weight, 0);
  if (total === 0) return "all paused";
  return all
    .map((v) => `${v.variant}: ${Math.round((v.weight / total) * 100)}%`)
    .join(" · ");
}
