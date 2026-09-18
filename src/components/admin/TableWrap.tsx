import type { ReactNode } from "react";

/** Horizontal scroll + optional sticky first column for admin tables. */
export function TableWrap({
  children,
  className = "",
  stickyFirst = true,
}: {
  children: ReactNode;
  className?: string;
  stickyFirst?: boolean;
}) {
  return (
    <div
      className={`tt-acct-table-wrap ${stickyFirst ? "" : "tt-table-wrap-loose"} ${className}`.trim()}
    >
      {children}
    </div>
  );
}
