"use client";

import { useMemo, useState } from "react";

import type { UpsellOfferRecord, UpsellItemRecord } from "@/lib/upsells/data";

function fmtNzd(cents: number) {
  return new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD", maximumFractionDigits: 0 }).format(
    cents / 100
  );
}

export function UpsellApproval({ offer }: { offer: UpsellOfferRecord }) {
  const [items, setItems] = useState<UpsellItemRecord[]>(offer.items);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const acceptedTotal = useMemo(
    () => items.filter((i) => i.status === "accepted").reduce((sum, i) => sum + i.price_cents, 0),
    [items]
  );
  const allResolved = items.every((i) => i.status !== "pending");
  const anyAccepted = items.some((i) => i.status === "accepted");

  async function respond(item: UpsellItemRecord, action: "accept" | "decline") {
    setPendingId(item.id);
    setError(null);
    try {
      const res = await fetch(`/api/portal/upsells/${offer.id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: item.id, action }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Something went wrong");
      }
      const data = (await res.json()) as { item: UpsellItemRecord };
      setItems((prev) => prev.map((i) => (i.id === item.id ? data.item : i)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <main className="portalShell upsellShell">
      <header className="upsellHead">
        <p className="portalEyebrow">Clean Car Collective</p>
        <h1 className="portalTitle">While we had your car&hellip;</h1>
        <p className="portalSub">
          Our team spotted {items.length === 1 ? "something" : `${items.length} things`} worth sorting. Have a look
          and add anything you want to this visit - one tap, and we&rsquo;ll take care of it before you&rsquo;re back.
        </p>
      </header>

      <div className="upsellList">
        {items.map((item) => {
          const busy = pendingId === item.id;
          const photo = item.photo_paths[0];
          return (
            <article key={item.id} className={`upsellCard${item.status === "declined" ? " upsellCard--declined" : ""}`}>
              {photo ? (
                <div className="upsellPhotoWrap">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo} alt={item.title} className="upsellPhoto" />
                  {item.photo_paths.length > 1 ? (
                    <span className="upsellPhotoCount">+{item.photo_paths.length - 1}</span>
                  ) : null}
                </div>
              ) : null}

              <div className="upsellBody">
                <div className="upsellTitleRow">
                  <h2 className="upsellTitle">{item.title}</h2>
                  <span className="upsellPrice">{fmtNzd(item.price_cents)}</span>
                </div>
                {item.description ? <p className="upsellDesc">{item.description}</p> : null}

                {item.status === "pending" ? (
                  <div className="upsellActions">
                    <button
                      type="button"
                      className="portalPrimaryBtn"
                      onClick={() => respond(item, "accept")}
                      disabled={busy}
                    >
                      {busy ? "Adding…" : `Add to my detail · ${fmtNzd(item.price_cents)}`}
                    </button>
                    <button
                      type="button"
                      className="portalGhostBtn"
                      onClick={() => respond(item, "decline")}
                      disabled={busy}
                    >
                      No thanks
                    </button>
                  </div>
                ) : item.status === "accepted" ? (
                  <p className="upsellStatus upsellStatus--added">✓ Added to your booking</p>
                ) : (
                  <p className="upsellStatus upsellStatus--declined">Maybe next time</p>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {error ? <p className="portalError">{error}</p> : null}

      <footer className="upsellFoot">
        {anyAccepted ? (
          <p className="upsellTotal">
            Added this visit: <strong>{fmtNzd(acceptedTotal)}</strong>
          </p>
        ) : null}
        {allResolved ? (
          <>
            <p className="upsellDone">
              {anyAccepted
                ? "Nice one - the team will sort it before your car's ready. No payment now; it's added to your booking."
                : "All good - nothing added. Thanks for taking a look."}
            </p>
            <a href="/account" className="portalGhostBtn">
              Go to my account
            </a>
          </>
        ) : (
          <p className="upsellFootHint">No payment now - anything you add goes on your booking and you pay as normal.</p>
        )}
      </footer>
    </main>
  );
}
