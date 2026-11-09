"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type NavLink = { href: string; label: string };
/** A top-level entry is either a plain link or a dropdown group of links. */
export type NavItem = NavLink | { label: string; children: NavLink[] };

function isGroup(item: NavItem): item is { label: string; children: NavLink[] } {
  return "children" in item;
}

/**
 * Global nav strip with active-page highlighting. Dropdown groups keep the
 * bar to a handful of tabs (Max, 9 Nov 2026: "too many tabs - consolidate").
 * A group is highlighted when any page inside it is open; the menu closes on
 * outside click, Escape, or navigation.
 */
export function GlobalNavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname() ?? "";
  const [open, setOpen] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(null), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/" || pathname.startsWith("/day/");
    if (href === "/sales") {
      // Exact-only: the other /sales/* pages are their own menu entries.
      return pathname === "/sales";
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <div className="globalNavLinks" ref={rootRef}>
      {items.map((item) => {
        if (!isGroup(item)) {
          return (
            <Link
              key={item.href}
              href={item.href as never}
              className="globalNavLink"
              aria-current={isActive(item.href) ? "page" : undefined}
            >
              {item.label}
            </Link>
          );
        }
        const groupActive = item.children.some((c) => isActive(c.href));
        const isOpen = open === item.label;
        return (
          <div key={item.label} className="globalNavGroup">
            <button
              type="button"
              className="globalNavLink globalNavGroupBtn"
              aria-current={groupActive ? "page" : undefined}
              aria-haspopup="menu"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : item.label)}
            >
              {item.label}
              <span className="globalNavCaret" aria-hidden>
                ▾
              </span>
            </button>
            {isOpen ? (
              <div className="globalNavMenu" role="menu">
                {item.children.map((c) => (
                  <Link
                    key={c.href}
                    href={c.href as never}
                    role="menuitem"
                    className="globalNavMenuItem"
                    aria-current={isActive(c.href) ? "page" : undefined}
                  >
                    {c.label}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
