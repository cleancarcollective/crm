"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = { href: string; label: string };

/**
 * Global nav link strip with active-page highlighting. Client component
 * so usePathname can mark the current section (aria-current="page" -
 * styled in globals.css).
 */
export function GlobalNavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname() ?? "";

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/" || pathname.startsWith("/day/");
    if (href === "/sales") {
      // Exact-only: the other /sales/* subpages have their own nav items.
      return pathname === "/sales";
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <div className="globalNavLinks">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href as never}
          className="globalNavLink"
          aria-current={isActive(item.href) ? "page" : undefined}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}
