"use client";

/**
 * Fire-and-forget in-portal behavioural event. Uses sendBeacon so it
 * still sends when the page is navigating away (e.g. join_start fired
 * right before the Stripe redirect). Never throws - analytics must not
 * break the portal.
 */
export function trackPortal(event: string, props?: Record<string, unknown>): void {
  try {
    const payload = JSON.stringify({ event, props: props ?? {} });
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const ok = navigator.sendBeacon("/api/portal/events", new Blob([payload], { type: "application/json" }));
      if (ok) return;
    }
    void fetch("/api/portal/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* swallow */
  }
}
