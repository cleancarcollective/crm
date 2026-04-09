"use client";

import { useState, useTransition } from "react";

type PricingRow = {
  service_name: string;
  size: string;
  price_ex_gst: number;
};

type SettingsClientProps = {
  shopName: string;
  autoRespondEnabled: boolean;
  pricingRows: PricingRow[];
};

const SERVICE_GROUPS = [
  "Deluxe Detail",
  "Premium Detail",
  "Deluxe Interior Detail",
  "Premium Interior Detail",
  "Deluxe Exterior Detail",
  "Premium Exterior Detail",
  "Ceramic Bronze (1 Year)",
  "Ceramic Silver (2 Year)",
  "Ceramic Gold (5 Year)",
  "Paint Correction 1-Step",
  "Paint Correction 2-Step",
];

export function SettingsClient({ shopName, autoRespondEnabled, pricingRows }: SettingsClientProps) {
  const [autoRespond, setAutoRespond] = useState(autoRespondEnabled);
  const [pricing, setPricing] = useState<PricingRow[]>(pricingRows);
  const [isPendingToggle, startToggle] = useTransition();
  const [isPendingPricing, startPricing] = useTransition();
  const [toggleMsg, setToggleMsg] = useState("");
  const [pricingMsg, setPricingMsg] = useState("");

  function handleToggle(enabled: boolean) {
    setAutoRespond(enabled);
    setToggleMsg("");
    startToggle(async () => {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoRespondEnabled: enabled }),
      });
      setToggleMsg(res.ok ? (enabled ? "Auto-respond enabled." : "Auto-respond disabled.") : "Failed to save.");
    });
  }

  function handlePriceChange(serviceName: string, size: string, value: string) {
    setPricing((prev) =>
      prev.map((row) =>
        row.service_name === serviceName && row.size === size
          ? { ...row, price_ex_gst: Number(value) || 0 }
          : row
      )
    );
  }

  function handleSavePricing() {
    setPricingMsg("");
    startPricing(async () => {
      const res = await fetch("/api/settings/pricing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: pricing }),
      });
      setPricingMsg(res.ok ? "Prices saved." : "Failed to save.");
    });
  }

  // Group pricing rows by service
  const pricingByService = new Map<string, PricingRow[]>();
  for (const row of pricing) {
    const existing = pricingByService.get(row.service_name) ?? [];
    existing.push(row);
    pricingByService.set(row.service_name, existing);
  }

  return (
    <main className="pageShell">
      <div className="pageTopbar">
        <div>
          <p className="eyebrow">Clean Car Collective CRM</p>
          <h1 className="pageTitle">Settings</h1>
          <p className="detailSubtitle">{shopName}</p>
        </div>
      </div>

      {/* ── Auto-respond toggle ─────────────────────────────────── */}
      <section className="detailPanel settingsSection">
        <h2>Auto-respond</h2>
        <p className="settingsDescription">
          When enabled, estimate emails are automatically sent to new leads (or queued for approval if they have notes or an unknown vehicle).
          Turn this off when you want to call leads personally instead.
        </p>
        <div className="settingsToggleRow">
          <button
            type="button"
            className={autoRespond ? "settingsToggleOn" : "settingsToggleOff"}
            onClick={() => handleToggle(!autoRespond)}
            disabled={isPendingToggle}
          >
            {autoRespond ? "ON — Auto-respond is active" : "OFF — Manual responses only"}
          </button>
          {toggleMsg ? <span className="settingsSaveMsg">{toggleMsg}</span> : null}
        </div>
        <div className="settingsToggleHint">
          {autoRespond ? (
            <span className="settingsHintGreen">New leads will receive an automated estimate email (or be queued for your approval).</span>
          ) : (
            <span className="settingsHintMuted">No emails will be auto-sent. All new leads appear as "new" for you to action manually.</span>
          )}
        </div>
      </section>

      {/* ── Pricing table ───────────────────────────────────────── */}
      <section className="detailPanel settingsSection">
        <div className="settingsPricingHeader">
          <div>
            <h2>Estimate pricing</h2>
            <p className="settingsDescription">Prices used in auto-respond estimate emails (ex GST).</p>
          </div>
          <div className="settingsPricingActions">
            <button
              type="button"
              className="buttonPrimary"
              onClick={handleSavePricing}
              disabled={isPendingPricing}
            >
              {isPendingPricing ? "Saving…" : "Save prices"}
            </button>
            {pricingMsg ? <span className="settingsSaveMsg">{pricingMsg}</span> : null}
          </div>
        </div>

        <div className="pricingTable">
          <div className="pricingTableHeader">
            <span>Service</span>
            <span>Size</span>
            <span>Price (ex GST)</span>
          </div>
          {SERVICE_GROUPS.map((serviceName) => {
            const rows = pricingByService.get(serviceName) ?? [];
            return rows.map((row, i) => (
              <div key={`${row.service_name}|${row.size}`} className="pricingTableRow">
                <span className={i === 0 ? "pricingServiceName" : "pricingServiceNameBlank"}>
                  {i === 0 ? row.service_name : ""}
                </span>
                <span className="pricingSizeLabel">{row.size}</span>
                <div className="pricingInputWrap">
                  <span className="pricingDollar">$</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    className="pricingInput"
                    value={row.price_ex_gst}
                    onChange={(e) => handlePriceChange(row.service_name, row.size, e.target.value)}
                  />
                </div>
              </div>
            ));
          })}
        </div>
      </section>
    </main>
  );
}
