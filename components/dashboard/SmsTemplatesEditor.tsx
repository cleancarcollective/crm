"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Template = {
  id: string;
  template_key: string;
  name: string;
  body_text: string;
  is_active: boolean;
  label: string;
  variables: { key: string; label: string }[];
};

export function SmsTemplatesEditor({ templates }: { templates: Template[] }) {
  const router = useRouter();
  const [seedMsg, setSeedMsg] = useState<string | null>(null);
  const [seedPending, startSeed] = useTransition();

  function handleSeed() {
    startSeed(async () => {
      const res = await fetch("/api/settings/sms-templates/seed", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSeedMsg(`Seeded ${data.inserted ?? 0} default templates.`);
        router.refresh();
      } else {
        setSeedMsg(`Failed: ${data.error ?? "unknown error"}`);
      }
    });
  }

  if (templates.length === 0) {
    return (
      <div className="templatesEmptyState">
        <p>No SMS templates yet. Click &ldquo;Seed defaults&rdquo; to install the standard set.</p>
        <button type="button" className="buttonPrimary" onClick={handleSeed} disabled={seedPending}>
          {seedPending ? "Seeding…" : "Seed default templates"}
        </button>
        {seedMsg ? <span className="settingsSaveMsg">{seedMsg}</span> : null}
      </div>
    );
  }

  return (
    <div className="smsTemplateList">
      {templates.map((t) => (
        <SmsTemplateRow key={t.id} template={t} />
      ))}
      <div className="templatesSeedFooter">
        <p className="templatesSeedFooterHint">
          Missing a template? Seed defaults adds any keys not in your DB without
          touching your existing edits.
        </p>
        <button type="button" className="buttonPrimary" onClick={handleSeed} disabled={seedPending}>
          {seedPending ? "Seeding…" : "Seed missing defaults"}
        </button>
        {seedMsg ? <span className="settingsSaveMsg">{seedMsg}</span> : null}
      </div>
    </div>
  );
}

function SmsTemplateRow({ template }: { template: Template }) {
  const router = useRouter();
  const [body, setBody] = useState(template.body_text);
  const [active, setActive] = useState(template.is_active);
  const [msg, setMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Approximate SMS segment count — 160 chars per GSM-7 segment, but emoji
  // and unicode reduce that to 70 per segment. We use 160 as a rough guide.
  const length = body.length;
  const segments = Math.max(1, Math.ceil(length / 160));

  function handleSave() {
    setMsg(null);
    startTransition(async () => {
      const res = await fetch(`/api/settings/sms-templates/${template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body_text: body, is_active: active }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMsg("Saved.");
        router.refresh();
      } else {
        setMsg(`Failed: ${data.error ?? "unknown error"}`);
      }
    });
  }

  function insertVariable(varKey: string) {
    const token = `{{${varKey}}}`;
    const ta = document.getElementById(`sms-${template.id}`) as HTMLTextAreaElement | null;
    if (!ta) {
      setBody((b) => b + token);
      return;
    }
    const start = ta.selectionStart ?? body.length;
    const end = ta.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(end));
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + token.length;
      ta.setSelectionRange(pos, pos);
    });
  }

  return (
    <div className="smsTemplateCard">
      <div className="smsTemplateHeader">
        <div>
          <div className="smsTemplateLabel">{template.label}</div>
          <div className="smsTemplateName">{template.name}</div>
        </div>
        <label className="smsTemplateActiveToggle">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          <span>{active ? "Active" : "Paused"}</span>
        </label>
      </div>

      <textarea
        id={`sms-${template.id}`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        className="smsTemplateTextarea"
        spellCheck
      />

      <div className="smsTemplateMeta">
        <span className="smsTemplateLen">
          {length} chars · {segments} SMS {segments === 1 ? "segment" : "segments"}
        </span>
        {template.variables.length > 0 && (
          <div className="smsTemplateVars">
            {template.variables.map((v) => (
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
        )}
      </div>

      <div className="smsTemplateActions">
        <button type="button" className="buttonPrimary" onClick={handleSave} disabled={isPending}>
          {isPending ? "Saving…" : "Save"}
        </button>
        {msg ? <span className="settingsSaveMsg">{msg}</span> : null}
      </div>
    </div>
  );
}
