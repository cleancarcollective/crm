"use client";

import { useEffect, useRef, useState } from "react";

import { UPSELL_CATALOG, presetById } from "@/lib/upsells/catalog";
import type { UpsellOfferRecord } from "@/lib/upsells/data";

/**
 * Staff intake-upsell tool on the booking page. Spot something during a
 * detail → snap a photo, pick a preset (or custom), set the price →
 * stage it → text the customer an auto-login link. They tap "add" and it
 * lands on the booking instantly. Nothing is sent until staff hit send.
 */

const MAX_PHOTOS = 4;

async function compressImage(file: File, maxW = 1600): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxW / bmp.width);
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.82);
}

type Draft = {
  addonId: string | null;
  title: string;
  priceDollars: number;
  durationMin: number;
  description: string;
  photos: string[];
};

function fmt(cents: number) {
  return `$${(cents / 100).toFixed(0)}`;
}

const quickPicks = UPSELL_CATALOG.filter((p) => p.quickPick);
const morePicks = UPSELL_CATALOG.filter((p) => !p.quickPick);

export function UpsellPanel({ bookingId }: { bookingId: string }) {
  const [presetId, setPresetId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState<string>("");
  const [duration, setDuration] = useState<string>("");
  const [desc, setDesc] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [items, setItems] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offers, setOffers] = useState<UpsellOfferRecord[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  async function loadOffers() {
    try {
      const d = await fetch(`/api/bookings/${bookingId}/upsells`).then((r) => r.json());
      setOffers(d.offers ?? []);
    } catch {
      /* non-fatal */
    }
  }
  useEffect(() => {
    void loadOffers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId]);

  function selectPreset(id: string) {
    setPresetId(id);
    if (id && id !== "custom") {
      const p = presetById(id)!;
      setTitle(p.name);
      setPrice(String(p.price));
      setDuration(String(p.durationMin));
    } else {
      setTitle("");
      setPrice("");
      setDuration("");
    }
  }

  async function onPickPhotos(files: FileList | null) {
    if (!files) return;
    setBusy(true);
    try {
      const added: string[] = [];
      for (const f of Array.from(files).slice(0, MAX_PHOTOS)) added.push(await compressImage(f));
      setPhotos((prev) => [...prev, ...added].slice(0, MAX_PHOTOS));
    } catch {
      setError("Could not read that photo");
    } finally {
      setBusy(false);
    }
  }

  function resetDraft() {
    setPresetId("");
    setTitle("");
    setPrice("");
    setDuration("");
    setDesc("");
    setPhotos([]);
  }

  function addItem() {
    const p = Number(price);
    if (!title.trim() || !p || p <= 0) {
      setError("Pick a service and a price first");
      return;
    }
    setItems((prev) => [
      ...prev,
      {
        addonId: presetId && presetId !== "custom" ? presetId : null,
        title: title.trim(),
        priceDollars: p,
        durationMin: Number(duration) || 0,
        description: desc.trim(),
        photos,
      },
    ]);
    resetDraft();
    setError(null);
    setResult(null);
  }

  async function send() {
    if (items.length === 0) return;
    setSending(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/bookings/${bookingId}/upsells`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items.map((it) => ({
            addon_id: it.addonId,
            title: it.title,
            description: it.description,
            price_cents: Math.round(it.priceDollars * 100),
            duration_min: it.durationMin,
            photos: it.photos,
          })),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { channel?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Send failed");
      setResult(
        data.channel === "sms"
          ? "✓ Texted to the customer"
          : data.channel === "email"
          ? "✓ Emailed to the customer (no mobile on file)"
          : "Saved, but we couldn't reach the customer - check their contact details"
      );
      setItems([]);
      await loadOffers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  const stagedTotal = items.reduce((s, it) => s + it.priceDollars, 0);
  const inputStyle: React.CSSProperties = {
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid var(--line)",
    background: "var(--panel-soft)",
    fontSize: 14,
    width: "100%",
  };

  return (
    <div className="detailPanel" style={{ marginTop: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2>💡 Suggest an upsell</h2>
        {busy ? <span style={{ fontSize: 12, color: "var(--muted)" }}>Processing photo…</span> : null}
      </div>
      <p className="settingsDescription" style={{ marginTop: 2 }}>
        Spotted something? Snap a photo, pick the fix, and text it over. The customer taps once and it&rsquo;s added
        to this booking - no payment now.
      </p>

      {/* Draft builder */}
      <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 12, marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {quickPicks.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => selectPreset(p.id)}
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                border: presetId === p.id ? "1.5px solid var(--success)" : "1px solid var(--line)",
                background: presetId === p.id ? "rgba(30,158,82,0.08)" : "var(--panel-soft)",
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {p.name} · ${p.price}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={presetId} onChange={(e) => selectPreset(e.target.value)} style={{ ...inputStyle, width: "auto", flex: "1 1 180px" }}>
            <option value="">More options…</option>
            {morePicks.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} (${p.price})
              </option>
            ))}
            <option value="custom">Custom / something else</option>
          </select>
        </div>

        <input style={inputStyle} placeholder="What we found (e.g. Kerbed front-left wheel)" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, color: "var(--muted)" }}>Price $ (ex-GST)</label>
            <input style={inputStyle} type="number" inputMode="decimal" placeholder="75" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, color: "var(--muted)" }}>Adds mins</label>
            <input style={inputStyle} type="number" inputMode="numeric" placeholder="30" value={duration} onChange={(e) => setDuration(e.target.value)} />
          </div>
        </div>
        <textarea style={{ ...inputStyle, minHeight: 52, resize: "vertical" }} placeholder="One line for the customer (optional) - e.g. We can machine this out today." value={desc} onChange={(e) => setDesc(e.target.value)} />

        {/* Photos */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {photos.map((p, i) => (
            <div key={i} style={{ position: "relative" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)" }} />
              <button
                type="button"
                onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}
                style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: 999, border: "none", background: "#111", color: "#fff", fontSize: 11, cursor: "pointer", lineHeight: 1 }}
              >
                ×
              </button>
            </div>
          ))}
          {photos.length < MAX_PHOTOS ? (
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} style={{ width: 56, height: 56, borderRadius: 8, border: "2px dashed var(--line)", background: "var(--panel-soft)", fontSize: 18, cursor: "pointer", color: "var(--muted)" }}>
              📷
            </button>
          ) : null}
          <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple style={{ display: "none" }} onChange={(e) => { void onPickPhotos(e.target.files); e.target.value = ""; }} />
        </div>

        <button type="button" className="buttonGhost" onClick={addItem} style={{ alignSelf: "flex-start" }}>
          + Add to list
        </button>
      </div>

      {/* Staged items */}
      {items.length > 0 ? (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map((it, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 10 }}>
              {it.photos[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.photos[0]} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6 }} />
              ) : null}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{it.title}</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  ${it.priceDollars}
                  {it.durationMin ? ` · ~${it.durationMin} min` : ""}
                </div>
              </div>
              <button type="button" onClick={() => setItems((prev) => prev.filter((_, j) => j !== i))} style={{ border: "none", background: "none", color: "var(--muted)", cursor: "pointer", fontSize: 18 }}>
                ×
              </button>
            </div>
          ))}
          <button type="button" className="buttonPrimary" onClick={send} disabled={sending}>
            {sending ? "Sending…" : `Text customer (${items.length}) · $${stagedTotal}`}
          </button>
        </div>
      ) : null}

      {result ? <p style={{ color: "var(--success)", fontSize: 13, marginTop: 10 }}>{result}</p> : null}
      {error ? <p style={{ color: "var(--danger, #c0392b)", fontSize: 13, marginTop: 10 }}>{error}</p> : null}

      {/* Past offers + outcomes */}
      {offers.length > 0 ? (
        <div style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>
            Sent
          </div>
          {offers.map((o) => (
            <div key={o.id} style={{ marginBottom: 10 }}>
              {o.items.map((it) => {
                const badge =
                  it.status === "accepted" ? { t: "Accepted", c: "var(--success)" } : it.status === "declined" ? { t: "Declined", c: "var(--muted)" } : { t: o.status === "viewed" ? "Viewed" : "Sent", c: "var(--muted)" };
                return (
                  <div key={it.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}>
                    <span>
                      {it.title} · {fmt(it.price_cents)}
                    </span>
                    <span style={{ color: badge.c, fontWeight: 600 }}>{badge.t}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
