"use client";

import { useId, useMemo } from "react";
import { useDb } from "@/lib/hooks";
import { knownTransports } from "@/lib/transport";

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  name?: string;
  disabled?: boolean;
};

/**
 * Transport is typed by hand at checkout, on the profile, on punched orders
 * and again on the packing slip. Offering what has already been used keeps the
 * same transporter spelled the same way everywhere.
 *
 * Suggestions come from the local database copy, which the server has already
 * scoped to the signed-in user — a dealer only ever sees their own.
 */
export function TransportInput({
  value,
  onChange,
  placeholder,
  className,
  name,
  disabled,
}: Props) {
  const { db } = useDb();
  const listId = useId();
  const options = useMemo(() => knownTransports(db), [db]);

  return (
    <>
      <input
        className={className ?? "tt-input"}
        name={name}
        value={value}
        disabled={disabled}
        list={options.length && !disabled ? listId : undefined}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {options.length ? (
        <datalist id={listId}>
          {options.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      ) : null}
    </>
  );
}
