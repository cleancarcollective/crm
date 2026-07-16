"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Staff before/after photo tool on the booking page. Template-driven:
 * the service decides which pair templates are suggested (Exterior /
 * Interior / Wheels), plus a custom pair for anything else.
 *
 * The "before" is SAVED to the server the moment it's taken (kind='before',
 * staged=true) - the after usually lands hours later, often after the tab
 * has been reloaded or on a different phone, so it can't live in React
 * state. Staged befores are hidden from the customer; when the after
 * arrives we composite the pair on-device (fetching the staged before by
 * URL), upload it, and delete the staged row.
 *
 * Nothing is ever auto-sent: finished pairs collect in the panel and staff
 * hit "Send to customer" when the set looks right. File inputs carry no
 * `capture` attr, so the picker offers Camera and Photo Library.
 */

type PhotoRow = { id: string; public_url: string; kind: string; label: string | null; notified: boolean; staged: boolean; created_at: string };

const MAX_W = 1600;
const HALF_W = MAX_W / 2;
const OUT_H = 900;

function templatesForService(serviceName: string): string[] {
  const s = serviceName.toLowerCase();
  const isInteriorOnly = s.includes("interior") && !s.includes("detail &") && !s.includes("premium detail") && !s.includes("deluxe detail") && !s.includes("exterior");
  if (isInteriorOnly) return ["Interior", "Seats & carpet"];
  if (s.includes("exterior") || s.includes("hand wash")) return ["Exterior", "Wheels"];
  if (s.includes("ceramic") || s.includes("correction") || s.includes("polish")) return ["Exterior", "Paintwork", "Wheels"];
  // Full details and everything else: the three that matter.
  return ["Exterior", "Interior", "Wheels"];
}

async function loadBitmap(src: File | string): Promise<ImageBitmap> {
  // A staged "before" comes back as a public URL - fetch it, then decode.
  if (typeof src === "string") {
    const res = await fetch(src);
    return createImageBitmap(await res.blob());
  }
  return createImageBitmap(src);
}

/** Downscaled JPEG data-url, used when staging a lone "before" shot. */
async function compressToDataUrl(file: File, maxW = 1600): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxW / bmp.width);
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.85);
}

function drawCover(ctx: CanvasRenderingContext2D, img: ImageBitmap, dx: number, dy: number, dw: number, dh: number) {
  const scale = Math.max(dw / img.width, dh / img.height);
  const sw = dw / scale;
  const sh = dh / scale;
  const sx = (img.width - sw) / 2;
  const sy = (img.height - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

function drawTag(ctx: CanvasRenderingContext2D, text: string, x: number, y: number) {
  ctx.font = "bold 34px 'Helvetica Neue', Arial, sans-serif";
  const w = ctx.measureText(text).width + 36;
  const h = 52;
  ctx.fillStyle = "rgba(17,17,17,0.78)";
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 26);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + 18, y + h / 2 + 2);
}

async function compositePair(before: File | string, after: File, logo: HTMLImageElement | null): Promise<string> {
  const [bImg, aImg] = await Promise.all([loadBitmap(before), loadBitmap(after)]);
  const canvas = document.createElement("canvas");
  canvas.width = MAX_W;
  canvas.height = OUT_H;
  const ctx = canvas.getContext("2d")!;

  drawCover(ctx, bImg, 0, 0, HALF_W, OUT_H);
  drawCover(ctx, aImg, HALF_W, 0, HALF_W, OUT_H);

  // Divider
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(HALF_W - 3, 0, 6, OUT_H);

  drawTag(ctx, "BEFORE", 20, 20);
  drawTag(ctx, "AFTER", HALF_W + 20, 20);

  if (logo) {
    const lw = Math.round(MAX_W * 0.09);
    const lh = Math.round(lw * (logo.naturalHeight / logo.naturalWidth));
    const pad = 24;
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 10;
    ctx.globalAlpha = 0.92;
    ctx.drawImage(logo, MAX_W - lw - pad, OUT_H - lh - pad, lw, lh);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  return canvas.toDataURL("image/jpeg", 0.85);
}

// ── Pair slot card ─────────────────────────────────────────────────────

function PairCard({
  label,
  disabled,
  stagedBefore,
  onStageBefore,
  onComplete,
  onDiscardBefore,
}: {
  label: string;
  disabled: boolean;
  /** A "before" already saved on the server, waiting for its after. */
  stagedBefore: PhotoRow | null;
  onStageBefore: (label: string, file: File) => void;
  onComplete: (label: string, beforeUrl: string, after: File) => void;
  onDiscardBefore: (photoId: string) => void;
}) {
  const beforeInput = useRef<HTMLInputElement>(null);
  const afterInput = useRef<HTMLInputElement>(null);
  const hasBefore = !!stagedBefore;

  const slot = (
    which: "before" | "after",
    filled: boolean,
    url: string | null,
    ref: React.RefObject<HTMLInputElement | null>,
    onPick: (f: File) => void,
    slotDisabled: boolean
  ) => (
    <button
      type="button"
      onClick={() => ref.current?.click()}
      disabled={slotDisabled}
      title={which === "after" && !hasBefore ? "Take the before shot first" : undefined}
      style={{
        flex: 1,
        minHeight: 92,
        borderRadius: 10,
        border: filled ? "2px solid var(--success)" : "2px dashed var(--line)",
        background: url ? `url(${url}) center/cover` : "var(--panel-soft)",
        color: filled ? "transparent" : "var(--muted)",
        fontSize: 13,
        fontWeight: 700,
        cursor: slotDisabled ? "not-allowed" : "pointer",
        opacity: slotDisabled && !filled ? 0.5 : 1,
        position: "relative",
      }}
    >
      {!filled ? `📷 ${which === "before" ? "Before" : "After"}` : null}
      {/* No `capture` attr on purpose - the picker offers Camera AND Photo Library. */}
      <input
        ref={ref}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = "";
        }}
      />
    </button>
  );

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 10 }}>
      <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 700 }}>{label}</p>
      <div style={{ display: "flex", gap: 8 }}>
        {slot("before", hasBefore, stagedBefore?.public_url ?? null, beforeInput, (f) => onStageBefore(label, f), disabled)}
        {slot(
          "after",
          false,
          null,
          afterInput,
          (f) => { if (stagedBefore) onComplete(label, stagedBefore.public_url, f); },
          disabled || !hasBefore
        )}
      </div>
      {hasBefore ? (
        <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--success)", fontWeight: 600 }}>
          ✓ Before saved - come back any time for the after.{" "}
          <button
            type="button"
            onClick={() => onDiscardBefore(stagedBefore!.id)}
            disabled={disabled}
            style={{ border: "none", background: "none", color: "var(--muted)", textDecoration: "underline", cursor: "pointer", fontSize: 11, padding: 0 }}
          >
            Retake
          </button>
        </p>
      ) : null}
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────

export function DetailPhotoPanel({ bookingId, serviceName }: { bookingId: string; serviceName: string }) {
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sentMsg, setSentMsg] = useState<string | null>(null);
  const [customLabel, setCustomLabel] = useState("");
  const [customKey, setCustomKey] = useState(0);
  const logoRef = useRef<HTMLImageElement | null>(null);

  const templates = useMemo(() => templatesForService(serviceName), [serviceName]);

  useEffect(() => {
    const img = new Image();
    img.src = "/images/ccc-logo-white.png";
    img.onload = () => { logoRef.current = img; };
  }, []);

  const load = useCallback(async () => {
    const res = await fetch(`/api/bookings/${bookingId}/photos`);
    if (res.ok) {
      const data = (await res.json()) as { photos: PhotoRow[] };
      setPhotos(data.photos);
    }
  }, [bookingId]);

  useEffect(() => { void load(); }, [load]);

  /**
   * Save a lone "before" straight away. The after often lands hours later
   * (and maybe on another phone), so it can't just live in React state.
   * Staged photos are hidden from the customer until the pair is built.
   */
  async function handleStageBefore(label: string, file: File) {
    setBusy(true);
    setError(null);
    setSentMsg(null);
    try {
      setProgress(`Saving ${label} before shot…`);
      const data = await compressToDataUrl(file);
      const res = await fetch(`/api/bookings/${bookingId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photos: [{ data, kind: "before", label, staged: true }] }),
      });
      const out = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !out.ok) throw new Error(out.error ?? "Could not save the before shot");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the before shot");
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  async function handlePair(label: string, beforeUrl: string, after: File) {
    setBusy(true);
    setError(null);
    setSentMsg(null);
    try {
      setProgress(`Building ${label} before/after…`);
      const data = await compositePair(beforeUrl, after, logoRef.current);
      setProgress("Uploading…");
      const res = await fetch(`/api/bookings/${bookingId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photos: [{ data, kind: "pair", label }] }),
      });
      const out = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !out.ok) throw new Error(out.error ?? "Upload failed");
      // Pair is built - drop the staged before so it can't linger.
      const staged = photos.find((p) => p.staged && p.label === label);
      if (staged) {
        await fetch(`/api/bookings/${bookingId}/photos?photo_id=${encodeURIComponent(staged.id)}`, { method: "DELETE" });
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  async function send() {
    setSending(true);
    setError(null);
    setSentMsg(null);
    try {
      const res = await fetch(`/api/bookings/${bookingId}/photos/notify`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Send failed");
      setSentMsg("✓ Sent - the customer has been emailed their photos.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  async function remove(photoId: string) {
    await fetch(`/api/bookings/${bookingId}/photos?photo_id=${encodeURIComponent(photoId)}`, { method: "DELETE" });
    await load();
  }

  // Staged "before" shots are work-in-progress, not deliverables: they
  // never count toward the collected set or the send button.
  const stagedFor = (label: string) => photos.find((p) => p.staged && p.label === label) ?? null;
  const finished = photos.filter((p) => !p.staged);
  const unsent = finished.filter((p) => !p.notified).length;

  return (
    <div className="detailPanel" style={{ marginTop: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2>📸 Before &amp; after photos</h2>
        {busy ? <span style={{ fontSize: 12, color: "var(--muted)" }}>{progress}</span> : null}
      </div>
      <p className="settingsDescription" style={{ marginTop: 2 }}>
        Tap Before, tap After - the branded side-by-side builds itself. Collect the set, then send
        it once. Nothing goes to the customer until you hit send.
      </p>

      {/* Suggested templates for this service + custom */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 10, marginTop: 10 }}>
        {templates.map((t) => (
          <PairCard
            key={t}
            label={t}
            disabled={busy}
            stagedBefore={stagedFor(t)}
            onStageBefore={handleStageBefore}
            onComplete={handlePair}
            onDiscardBefore={remove}
          />
        ))}
        {/* A staged before under a custom label - rebuild its card after a
            reload so the after shot can still find it. */}
        {photos
          .filter((p) => p.staged && p.label && !templates.includes(p.label))
          .map((p) => (
            <PairCard
              key={`staged-${p.id}`}
              label={p.label as string}
              disabled={busy}
              stagedBefore={p}
              onStageBefore={handleStageBefore}
              onComplete={handlePair}
              onDiscardBefore={remove}
            />
          ))}
        <div style={{ border: "1px dashed var(--line)", borderRadius: 12, padding: 10 }}>
          <input
            className="detailInput"
            style={{ maxWidth: "100%", textAlign: "left", marginBottom: 8 }}
            placeholder="Custom - e.g. Boot, Engine bay"
            value={customLabel}
            onChange={(e) => setCustomLabel(e.target.value)}
          />
          {customLabel.trim() ? (
            <PairCard
              key={customKey}
              label={customLabel.trim()}
              disabled={busy}
              stagedBefore={stagedFor(customLabel.trim())}
              onStageBefore={handleStageBefore}
              onComplete={(l, b, a) => {
                void handlePair(l, b, a);
                setCustomLabel("");
                setCustomKey((k) => k + 1);
              }}
              onDiscardBefore={remove}
            />
          ) : (
            <p style={{ margin: 0, fontSize: 11, color: "var(--muted)" }}>Name it and before/after slots appear.</p>
          )}
        </div>
      </div>

      {error ? <p className="editorError">{error}</p> : null}
      {sentMsg ? <p style={{ margin: "10px 0 0", fontSize: 13, fontWeight: 600, color: "var(--success)" }}>{sentMsg}</p> : null}

      {/* Collected set */}
      {finished.length > 0 ? (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, margin: "16px 0 8px", flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>
              Collected ({finished.length}){unsent > 0 ? ` · ${unsent} not sent yet` : " · all sent"}
            </span>
            <button
              type="button"
              className="buttonPrimary"
              onClick={send}
              disabled={sending || unsent === 0}
              style={{ padding: "10px 18px" }}
            >
              {sending ? "Sending…" : unsent > 0 ? `Send ${unsent} to customer` : "All sent ✓"}
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
            {finished.map((p) => (
              <div key={p.id} style={{ position: "relative" }}>
                <a href={p.public_url} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.public_url}
                    alt={p.label ?? "Detail photo"}
                    style={{ width: "100%", aspectRatio: "16/9", objectFit: "cover", borderRadius: 10, display: "block" }}
                  />
                </a>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 3 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 600 }}>{p.label ?? "Photo"}</span>
                  <span style={{ fontSize: 10.5, color: p.notified ? "var(--success)" : "var(--muted)" }}>
                    {p.notified ? "sent ✓" : "not sent"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void remove(p.id)}
                  aria-label="Delete"
                  style={{
                    position: "absolute", top: 4, right: 4, width: 26, height: 26,
                    borderRadius: 13, border: "none", background: "rgba(0,0,0,0.6)",
                    color: "#fff", fontSize: 13, cursor: "pointer", lineHeight: 1,
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
