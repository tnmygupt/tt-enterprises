"use client";

import type { Order } from "@/lib/types";
import { buildOrderStageViews } from "@/lib/order-stages";

export function OrderStageTracker({
  order,
  locale,
}: {
  order: Order;
  locale: "en" | "hi";
}) {
  const stages = buildOrderStageViews(order);
  const hi = locale === "hi";

  return (
    <div className="rounded-2xl border-2 border-[var(--brand-deep)]/20 bg-white p-4">
      <h2 className="tt-display text-xl text-[var(--brand-deep)]">
        {hi ? "ऑर्डर स्टेज" : "Order stages"}
      </h2>
      <ol className="mt-4 space-y-0">
        {stages.map((s, i) => {
          const label = hi ? s.labelHi : s.labelEn;
          return (
            <li key={`${s.key}-${i}`} className="flex gap-3">
              <div className="flex w-6 flex-col items-center">
                <span
                  className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black ${
                    s.current
                      ? "bg-[var(--brand-deep)] text-white"
                      : s.done
                        ? "bg-[var(--ok)] text-white"
                        : "border-2 border-[var(--line)] bg-white text-[var(--ink-muted)]"
                  }`}
                >
                  {s.done ? "✓" : i + 1}
                </span>
                {i < stages.length - 1 ? (
                  <span
                    className={`min-h-[18px] w-0.5 flex-1 ${
                      s.done ? "bg-[var(--ok)]" : "bg-[var(--line)]"
                    }`}
                  />
                ) : null}
              </div>
              <div className="pb-3">
                <p
                  className={`text-sm font-bold ${
                    s.current
                      ? "text-[var(--brand-deep)]"
                      : s.done
                        ? "text-[var(--ok)]"
                        : "text-[var(--ink-muted)]"
                  }`}
                >
                  {label}
                  {s.current ? (
                    <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                      {hi ? "अभी" : "current"}
                    </span>
                  ) : null}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
