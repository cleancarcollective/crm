"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Staff photo tool on the booking page. Designed for a phone in a wet
 * hand: one giant "Add photos" button (opens the camera / gallery),
 * everything else automatic - photos are branded with the CCC logo
 * client-side, compressed, uploaded, and the FIRST batch auto-emails
 * the customer. Zero extra taps.
 */

type PhotoRow = { id: string; public_url: string; kind: string; notified: boolean; created_at: string };

const MAX_DIM = 1920;

async function watermark(file: File, logo: HTMLImageElement | null): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, w, h);

  if (logo) {
    // Logo bottom-right at ~14% of width, with a soft shadow for
    // legibility on light paintwork.
    const lw = Math.round(w * 0.14);
    const lh = Math.round(lw * (logo.naturalHeight / logo.naturalWidth));
    const pad = Math.round(w * 0.03);
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = Math.max(4, Math.round(w * 0.008));
    ctx.globalAlpha = 0.9;
    ctx.drawImage(logo, w - lw - pad, h - lh - pad, lw, lh);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  return canvas.toDataURL("image/jpeg", 0.82);
}

export function DetailPhotoPanel({ bookingId }: { bookingId: string }) {
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [emailedNow, setEmailedNow] = useState(false);
  const logoRef = useRef<HTMLImageElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    setEmailedNow(false);
    try {
      const list = Array.from(files).slice(0, 12);
      const payload: Array<{ data: string; kind: string }> = [];
      for (let i = 0; i < list.length; i += 1) {
        setProgress(`Branding ${i + 1}/${list.length}…`);
        payload.push({ data: await watermark(list[i], logoRef.current), kind: "during" });
      }
      setProgress(`Uploading ${payload.length} photo${payload.length === 1 ? "" : "s"}…`);
      const res = await fetch(`/api/bookings/${bookingId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photos: payload }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; emailed?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Upload failed");
      if (data.emailed) setEmailedNow(true);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      setProgress("");
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove(photoId: string) {
    await fetch(`/api/bookings/${bookingId}/photos?photo_id=${encodeURIComponent(photoId)}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="detailPanel" style={{ marginTop: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2>📸 Detail photos</h2>
        {photos.length > 0 ? (
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {photos.length} photo{photos.length === 1 ? "" : "s"}
            {photos.some((p) => p.notified) ? " · customer emailed ✓" : ""}
          </span>
        ) : null}
      </div>
      <p className="settingsDescription" style={{ marginTop: 2 }}>
        Snap or pick from the gallery - the CCC logo is stamped on automatically and the customer
        gets an email with the first batch. Photos appear in their account.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={(e) => void handleFiles(e.target.files)}
      />
      <button
        type="button"
        className="buttonPrimary"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        style={{ width: "100%", padding: "16px", fontSize: 16, marginTop: 8 }}
      >
        {busy ? progress || "Working…" : "📷 Add photos"}
      </button>
      {emailedNow ? (
        <p style={{ margin: "10px 0 0", fontSize: 13, fontWeight: 600, color: "var(--success)" }}>
          ✓ Uploaded + photos emailed to the customer.
        </p>
      ) : null}
      {error ? <p className="editorError">{error}</p> : null}

      {photos.length > 0 ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
            gap: 8,
            marginTop: 14,
          }}
        >
          {photos.map((p) => (
            <div key={p.id} style={{ position: "relative" }}>
              <a href={p.public_url} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.public_url}
                  alt="Detail photo"
                  style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 10, display: "block" }}
                />
              </a>
              <button
                type="button"
                onClick={() => void remove(p.id)}
                aria-label="Delete photo"
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
      ) : null}
    </div>
  );
}
