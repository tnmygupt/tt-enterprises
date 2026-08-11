"use client";

import {
  useEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
} from "react";

type NumberFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange" | "defaultValue"
> & {
  /** Controlled value — number, numeric string, or "". */
  value: number | string | "";
  onValueChange: (value: number | "") => void;
  /** Commit empty as this number on blur (default 0). Pass null to leave empty as "". */
  emptyAs?: number | null;
  /** Select existing value on focus so typing replaces (default true). */
  selectAllOnFocus?: boolean;
  /** Prefer integer keypad / strip decimals while typing. */
  integer?: boolean;
};

function toDraft(value: number | string | "" | null | undefined): string {
  if (value === "" || value == null) return "";
  return String(value);
}

/**
 * Number input that lets you clear a value and type a new one without the
 * field snapping back (e.g. default 1 → type 5 becoming 15).
 */
export function NumberField({
  value,
  onValueChange,
  emptyAs = 0,
  selectAllOnFocus = true,
  integer = false,
  onBlur,
  onFocus,
  className,
  inputMode,
  ...rest
}: NumberFieldProps) {
  const [draft, setDraft] = useState(() => toDraft(value));
  const focused = useRef(false);

  useEffect(() => {
    if (focused.current) return;
    setDraft(toDraft(value));
  }, [value]);

  const commit = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed === "-" || trimmed === ".") {
      if (emptyAs === null) {
        onValueChange("");
        setDraft("");
      } else {
        onValueChange(emptyAs);
        setDraft(String(emptyAs));
      }
      return;
    }
    const n = Number(trimmed);
    if (Number.isFinite(n)) {
      const out = integer ? Math.trunc(n) : n;
      onValueChange(out);
      setDraft(String(out));
    }
  };

  const pattern = integer ? /^-?\d*$/ : /^-?\d*\.?\d*$/;

  return (
    <input
      {...rest}
      type="text"
      inputMode={inputMode ?? (integer ? "numeric" : "decimal")}
      className={className}
      value={draft}
      onFocus={(e) => {
        focused.current = true;
        if (selectAllOnFocus) {
          requestAnimationFrame(() => {
            try {
              e.target.select();
            } catch {
              /* ignore */
            }
          });
        }
        onFocus?.(e);
      }}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === "" || pattern.test(raw)) {
          setDraft(raw);
          if (raw === "" || raw === "-" || raw === ".") {
            if (emptyAs === null) onValueChange("");
            return;
          }
          const n = Number(raw);
          if (Number.isFinite(n)) {
            onValueChange(integer ? Math.trunc(n) : n);
          }
        }
      }}
      onBlur={(e) => {
        focused.current = false;
        commit(draft);
        onBlur?.(e);
      }}
    />
  );
}
