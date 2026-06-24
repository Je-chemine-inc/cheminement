"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { Home } from "lucide-react";
import { cn } from "@/lib/utils";
import { searchCities } from "@/lib/city-search";

interface CitySearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
  name?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * City autocomplete for Quebec/Canada. Behaves like a normal text input — the
 * typed value is always kept (free-text fallback for postal codes / small towns
 * not in the list) — but offers fuzzy, accent-insensitive city suggestions as
 * you type. Picking a suggestion fills the canonical "City, QC" value, which is
 * what keeps the data consistent enough to drive the matcher's location bonus.
 */
export const CitySearch = React.forwardRef<HTMLInputElement, CitySearchProps>(
  (
    { value, onChange, placeholder, id, name, disabled = false, className },
    ref,
  ) => {
    const [query, setQuery] = useState(value ?? "");
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(-1);
    const containerRef = useRef<HTMLDivElement>(null);
    const listId = useId();

    // Keep the visible text in sync when the value is set externally (e.g. a
    // form reset or a profile load) — but not while the user is mid-typing.
    useEffect(() => {
      setQuery(value ?? "");
    }, [value]);

    const suggestions = open && query.trim() ? searchCities(query) : [];

    useEffect(() => {
      const onClickOutside = (e: MouseEvent) => {
        if (
          containerRef.current &&
          !containerRef.current.contains(e.target as Node)
        ) {
          setOpen(false);
        }
      };
      document.addEventListener("mousedown", onClickOutside);
      return () => document.removeEventListener("mousedown", onClickOutside);
    }, []);

    const pick = (city: string) => {
      setQuery(city);
      onChange(city);
      setOpen(false);
      setActive(-1);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!open || suggestions.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, suggestions.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        if (active >= 0 && active < suggestions.length) {
          e.preventDefault();
          pick(suggestions[active]);
        }
      } else if (e.key === "Escape") {
        setOpen(false);
        setActive(-1);
      }
    };

    return (
      <div ref={containerRef} className={cn("relative", className)}>
        <Home className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <input
          ref={ref}
          id={id}
          name={name}
          type="text"
          autoComplete="off"
          role="combobox"
          aria-expanded={open && suggestions.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            active >= 0 ? `${listId}-opt-${active}` : undefined
          }
          value={query}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => {
            const v = e.target.value;
            setQuery(v);
            onChange(v); // free-text: value follows typing
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          className="flex h-10 w-full rounded-md border border-input bg-background pl-10 pr-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        />
        {open && suggestions.length > 0 && (
          <ul
            id={listId}
            role="listbox"
            className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover p-1 shadow-md"
          >
            {suggestions.map((city, i) => (
              <li
                key={city}
                id={`${listId}-opt-${i}`}
                role="option"
                aria-selected={i === active}
              >
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(city)}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    "w-full rounded-sm px-3 py-2 text-left text-sm transition-colors",
                    i === active
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-muted",
                  )}
                >
                  {city}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  },
);

CitySearch.displayName = "CitySearch";
