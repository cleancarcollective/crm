"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type SearchVehicle = {
  id: string;
  make: string | null;
  model: string | null;
  year: string | null;
  rego: string | null;
};

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
 * Global nav search across leads + clients (contacts + their vehicles,
 * matched on name / email / phone / rego / make / model). Cmd+K or
 * Ctrl+K focuses from anywhere; arrows + Enter navigate; Esc closes.
 */
export function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchContact[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cmd+K / Ctrl+K global focus.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Focus the mobile input when the sheet opens.
  useEffect(() => {
    if (mobileOpen) mobileInputRef.current?.focus();
  }, [mobileOpen]);

  // Outside click closes.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
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
        setActive(0);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 220);
  }, []);

  const goTo = useCallback(
    (contact: SearchContact) => {
      setOpen(false);
      setMobileOpen(false);
      setQ("");
      setResults([]);
      inputRef.current?.blur();
      router.push(`/contacts/${contact.id}` as never);
    },
    [router]
  );

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      goTo(results[active]);
    }
  }

  const resultRows =
    results.length === 0 ? (
      <div className="globalSearchEmpty">{loading ? "Searching…" : q.trim().length >= 2 ? "No matches" : "Type a name, email, phone or rego"}</div>
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
    );

  return (
    <>
      {/* Desktop: inline search box (hidden on phones via CSS). */}
      <div className="globalSearch" ref={wrapRef}>
        <svg className="globalSearchIcon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.6" />
          <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          className="globalSearchInput"
          placeholder="Search customers…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            runSearch(e.target.value);
          }}
          onFocus={() => {
            if (results.length > 0 && q.trim().length >= 2) setOpen(true);
          }}
          onKeyDown={onInputKey}
          aria-label="Search leads and clients"
        />
        <kbd className="globalSearchKbd" aria-hidden="true">⌘K</kbd>

        {open ? (
          <div className="globalSearchResults" role="listbox">
            {resultRows}
          </div>
        ) : null}
      </div>

      {/* Mobile: icon button opens a full-width search sheet. */}
      <button
        type="button"
        className="globalSearchMobileBtn"
        onClick={() => setMobileOpen(true)}
        aria-label="Search customers"
      >
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.6" />
          <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>

      {mobileOpen ? (
        <div className="globalSearchSheet" role="dialog" aria-label="Search">
          <div className="globalSearchSheetBar">
            <svg className="globalSearchIcon globalSearchIcon--sheet" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.6" />
              <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <input
              ref={mobileInputRef}
              type="search"
              className="globalSearchSheetInput"
              placeholder="Search customers…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                runSearch(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") setMobileOpen(false);
                else onInputKey(e);
              }}
              aria-label="Search leads and clients"
            />
            <button
              type="button"
              className="globalSearchSheetCancel"
              onClick={() => {
                setMobileOpen(false);
                setQ("");
                setResults([]);
              }}
            >
              Cancel
            </button>
          </div>
          <div className="globalSearchSheetResults" role="listbox">
            {resultRows}
          </div>
        </div>
      ) : null}
    </>
  );
}
