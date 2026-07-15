"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type SearchVehicle = { make: string | null; model: string | null; year: string | null; rego: string | null };
type SearchContact = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  vehicles: SearchVehicle[];
};

function contactName(c: SearchContact) {
  return c.full_name || [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email || "Unknown";
}
function vehicleLine(c: SearchContact) {
  const v = c.vehicles?.[0];
  if (!v) return null;
  const label = [v.year, v.make, v.model].filter(Boolean).join(" ");
  return v.rego ? `${label} · ${v.rego}` : label || null;
}

/**
 * Directory search field with live typeahead. Sits inside the filter
 * form (name="q"), so pressing Enter with no suggestion highlighted (or
 * hitting Apply) still filters the list server-side. Typing shows
 * matching customers you can click to jump straight to their profile.
 */
export function DirectorySearchField({ defaultValue = "", placeholder }: { defaultValue?: string; placeholder?: string }) {
  const router = useRouter();
  const [q, setQ] = useState(defaultValue);
  const [results, setResults] = useState<SearchContact[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1); // -1 => Enter submits the filter
  const [loading, setLoading] = useState(false);
  const [maxH, setMaxH] = useState<number | undefined>(undefined);
  const wrapRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // Cap the dropdown to the space below the input so it never runs off the
  // bottom of the screen (the filter sits low on mobile) - it scrolls
  // internally instead. Recompute on open, scroll and resize.
  useEffect(() => {
    if (!open) return;
    function fit() {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const avail = window.innerHeight - wrap.getBoundingClientRect().bottom - 14;
      setMaxH(Math.max(150, Math.min(avail, 380)));
    }
    fit();
    window.addEventListener("resize", fit);
    window.addEventListener("scroll", fit, true);
    return () => {
      window.removeEventListener("resize", fit);
      window.removeEventListener("scroll", fit, true);
    };
  }, [open]);

  const runSearch = useCallback((query: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setResults([]);
      setOpen(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/contacts/search?q=${encodeURIComponent(query.trim())}`);
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { contacts: SearchContact[] };
        setResults(data.contacts ?? []);
        setActive(-1);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 200);
  }, []);

  const goTo = useCallback(
    (contact: SearchContact) => {
      setOpen(false);
      router.push(`/contacts/${contact.id}` as never);
    },
    [router]
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1 >= results.length ? 0 : a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a <= 0 ? results.length - 1 : a - 1));
    } else if (e.key === "Enter" && active >= 0 && results[active]) {
      // A suggestion is highlighted: jump to it instead of submitting.
      e.preventDefault();
      goTo(results[active]);
    }
    // Enter with no highlight falls through -> native form submit (filter).
  }

  return (
    <label className="filterField">
      <span>Search</span>
      <div className="directorySearchWrap" ref={wrapRef}>
        <input
          type="search"
          name="q"
          value={q}
          placeholder={placeholder ?? "Name, email, phone, service, vehicle"}
          className="filterInput"
          autoComplete="off"
          onChange={(e) => {
            setQ(e.target.value);
            runSearch(e.target.value);
          }}
          onFocus={() => {
            if (results.length > 0 && q.trim().length >= 2) setOpen(true);
          }}
          onKeyDown={onKeyDown}
          aria-label="Search customers"
        />
        {open ? (
          <div className="globalSearchResults directorySearchResults" role="listbox" style={maxH ? { maxHeight: maxH } : undefined}>
            {results.length === 0 ? (
              <div className="globalSearchEmpty">{loading ? "Searching…" : "No matches"}</div>
            ) : (
              results.map((c, i) => {
                const vehicle = vehicleLine(c);
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    className={`globalSearchItem${i === active ? " globalSearchItem--active" : ""}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => goTo(c)}
                  >
                    <span className="globalSearchItemName">{contactName(c)}</span>
                    <span className="globalSearchItemMeta">
                      {[c.email, c.phone].filter(Boolean).join(" · ") || "No contact details"}
                      {vehicle ? ` — ${vehicle}` : ""}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        ) : null}
      </div>
    </label>
  );
}
