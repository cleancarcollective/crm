"use client";

import { useState, useTransition } from "react";

type Props = {
  activeSlug: string;
  shops: Array<{ slug: string; name: string }>;
};

/**
 * Super-admin-only shop switcher rendered in the global nav. Posts the
 * selected slug to /api/admin/switch-shop, which sets the
 * crm_active_shop cookie. Then we hard-reload so every server component
 * re-fetches data scoped to the new shop.
 */
export function ShopSwitcher({ activeSlug, shops }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const slug = e.target.value;
    if (slug === activeSlug) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/admin/switch-shop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data?.error ?? "Failed to switch shop");
          return;
        }
        // Hard reload so all server components re-render with the new shop
        window.location.reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to switch shop");
      }
    });
  };

  return (
    <span className={`globalNavShopPill globalNavShopPill--${activeSlug} globalNavShopSwitcher`}>
      <select
        value={activeSlug}
        onChange={handleChange}
        disabled={isPending}
        aria-label="Switch shop"
        title={error ?? "Switch shop"}
        onClick={(e) => e.stopPropagation()}
      >
        {shops.map((s) => (
          <option key={s.slug} value={s.slug}>
            {s.name.replace("Clean Car Collective ", "") || s.name}
          </option>
        ))}
      </select>
    </span>
  );
}
