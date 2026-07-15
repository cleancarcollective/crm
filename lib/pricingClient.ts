"use client";

/**
 * Client-side cache for the shop's pricing catalogue. The New Booking
 * modal used to fetch /api/pricing every time it opened, and the first
 * hit after an idle period paid a serverless cold-start (~seconds). We
 * now fetch once per page load and share the promise, and prefetch on
 * page load so the function is already warm + the data cached by the
 * time staff open the modal.
 *
 * The cache is module-level (in memory), so a full page reload - which is
 * what a shop switch triggers - resets it. That keeps it correctly
 * shop-scoped without any key juggling.
 */

export type PricingService = {
  name: string;
  sizes: Record<string, number>;
};

let pricingPromise: Promise<PricingService[]> | null = null;

async function fetchPricing(): Promise<PricingService[]> {
  const res = await fetch("/api/pricing");
  if (!res.ok) throw new Error(`pricing ${res.status}`);
  const data = (await res.json()) as { services?: PricingService[] };
  return data.services ?? [];
}

/** Returns the cached pricing, fetching once and sharing the promise. */
export function getPricing(): Promise<PricingService[]> {
  if (!pricingPromise) {
    pricingPromise = fetchPricing().catch((err) => {
      // Reset on failure so a later call can retry instead of caching the error.
      pricingPromise = null;
      throw err;
    });
  }
  return pricingPromise;
}

/** Fire-and-forget warm-up; safe to call on page load. */
export function prefetchPricing(): void {
  void getPricing().catch(() => {
    /* non-fatal - the modal will retry on open */
  });
}
