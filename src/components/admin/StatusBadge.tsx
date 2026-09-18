import type { ReactNode } from "react";

export type StatusTone = "pending" | "ok" | "danger" | "muted" | "info";

const TONE: Record<StatusTone, string> = {
  pending: "tt-status tt-status-pending",
  ok: "tt-status tt-status-ok",
  danger: "tt-status tt-status-danger",
  muted: "tt-status tt-status-muted",
  info: "tt-status",
};

export function StatusBadge({
  tone = "info",
  children,
  className = "",
}: {
  tone?: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`${TONE[tone]} ${className}`.trim()}>{children}</span>
  );
}
