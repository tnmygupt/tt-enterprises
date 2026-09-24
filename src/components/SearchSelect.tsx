"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type Ref,
} from "react";

export type SearchSelectOption = {
  value: string;
  label: string;
  searchText?: string;
};

type SearchSelectProps = {
  options: SearchSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyLabel?: string;
  className?: string;
  required?: boolean;
  id?: string;
  disabled?: boolean;
  /** Max rows shown in the dropdown (default 120). */
  limit?: number;
  autoFocus?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  /** Hide the leading “clear” row (default: hidden when required). */
  allowClear?: boolean;
  /** After a pick, keep the input focused so the next search can start immediately. */
  keepFocusOnPick?: boolean;
};

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) return;
  if (typeof ref === "function") ref(value);
  else ref.current = value;
}

/** Type-to-search select for parties, catalog items, etc. */
export function SearchSelect({
  options,
  value,
  onChange,
  placeholder = "Search…",
  emptyLabel = "Clear",
  className = "",
  required,
  id,
  disabled,
  limit = 120,
  autoFocus,
  inputRef,
  allowClear,
  keepFocusOnPick,
}: SearchSelectProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const innerInputRef = useRef<HTMLInputElement | null>(null);
  const skipOpenRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);

  const showClear = allowClear ?? !required;
  const selected = options.find((o) => o.value === value);

  const filtered = (() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, limit);
    return options
      .filter((o) => (o.searchText || o.label).toLowerCase().includes(q))
      .slice(0, limit);
  })();

  const clearOffset = showClear ? 1 : 0;
  const maxHighlight = Math.max(0, filtered.length + clearOffset - 1);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    // Reset the keyboard cursor whenever the visible list changes
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHighlight(0);
  }, [query, open]);

  const pick = (v: string) => {
    onChange(v);
    setQuery("");
    setOpen(false);
    if (keepFocusOnPick) {
      skipOpenRef.current = true;
      requestAnimationFrame(() => {
        innerInputRef.current?.focus();
        skipOpenRef.current = false;
      });
    }
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <input
        id={id}
        ref={(el) => {
          innerInputRef.current = el;
          assignRef(inputRef, el);
        }}
        type="text"
        className="tt-input"
        disabled={disabled}
        required={required && !value}
        autoFocus={autoFocus}
        placeholder={selected ? selected.label : placeholder}
        value={open ? query : selected?.label || ""}
        onFocus={() => {
          if (skipOpenRef.current) return;
          setOpen(true);
          setQuery("");
        }}
        onChange={(e) => {
          setOpen(true);
          setQuery(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setHighlight((h) => Math.min(h + 1, maxHighlight));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (!open) {
              setOpen(true);
              return;
            }
            if (showClear && highlight === 0) {
              pick("");
              return;
            }
            const optIdx = showClear ? highlight - 1 : highlight;
            const opt = filtered[optIdx];
            if (opt) pick(opt.value);
          } else if (e.key === "Escape") {
            setOpen(false);
            setQuery("");
          }
        }}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-[var(--line)] bg-white py-1 shadow-lg"
        >
          {showClear ? (
            <li
              role="option"
              aria-selected={!value}
              className={`cursor-pointer px-3 py-2 text-sm text-[var(--ink-muted)] ${
                highlight === 0 ? "bg-[var(--brand-soft)]" : ""
              }`}
              onMouseEnter={() => setHighlight(0)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick("");
              }}
            >
              {emptyLabel}
            </li>
          ) : null}
          {filtered.map((o, i) => {
            const idx = i + clearOffset;
            return (
              <li
                key={o.value}
                role="option"
                aria-selected={o.value === value}
                className={`cursor-pointer px-3 py-2 text-sm ${
                  highlight === idx
                    ? "bg-[var(--brand-soft)] text-[var(--brand-deep)]"
                    : "text-[var(--ink)]"
                }`}
                onMouseEnter={() => setHighlight(idx)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o.value);
                }}
              >
                {o.label}
              </li>
            );
          })}
          {!filtered.length ? (
            <li className="px-3 py-2 text-sm text-[var(--ink-muted)]">
              {query.trim()
                ? "No matches"
                : options.length
                  ? "Type to narrow the list"
                  : "No options"}
            </li>
          ) : null}
          {filtered.length && options.length > limit && !query.trim() ? (
            <li className="px-3 py-1 text-xs text-[var(--ink-muted)]">
              Showing first {limit} — type to find more
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
