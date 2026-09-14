import type { DealerOrderDiscountView } from "@/lib/schemes";

export function OrderDiscountExplain({
  view,
  compact = false,
}: {
  view: DealerOrderDiscountView;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "space-y-1 text-sm" : "space-y-2 text-sm"}>
      <p className="text-[var(--ink-muted)]">{view.how}</p>
      {view.current ? (
        <p className="font-semibold text-[var(--ok)]">{view.current}</p>
      ) : null}
      {view.items?.length ? (
        <ul className={compact ? "space-y-0.5" : "space-y-1"}>
          {view.items.map((row) => (
            <li key={row.label} className="text-sm">
              <span
                className={
                  row.next
                    ? "text-[var(--ink)]"
                    : "font-semibold text-[var(--ok)]"
                }
              >
                {row.current}
              </span>
              {row.next ? (
                <span className="mt-0.5 block font-medium text-[var(--brand)]">
                  {row.next}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : view.next ? (
        <p className="font-medium text-[var(--brand)]">{view.next}</p>
      ) : null}
      <ul className="space-y-1">
        {view.tiers.map((row) => (
          <li key={`${row.need}-${row.off}`} className="flex justify-between gap-2">
            <span className="text-[var(--ink-muted)]">{row.need}</span>
            <span className="font-semibold tabular-nums">{row.off}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
