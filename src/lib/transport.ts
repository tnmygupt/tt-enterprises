import type { AppDatabase } from "./store/db";

/** Cap the datalist so a long order history stays usable in the dropdown. */
const MAX_SUGGESTIONS = 25;

/**
 * Transporters already used, most frequent first. Reads both the dealer
 * profiles and the order history so a name entered once at checkout is
 * offered everywhere afterwards.
 */
export function knownTransports(db: AppDatabase | null | undefined): string[] {
  if (!db) return [];
  const counts = new Map<string, { label: string; n: number }>();

  const add = (raw: string | undefined) => {
    const label = raw?.trim();
    if (!label) return;
    // Case/spacing differ between typists; count them as one transporter.
    const key = label.toLowerCase().replace(/\s+/g, " ");
    const existing = counts.get(key);
    if (existing) existing.n++;
    else counts.set(key, { label, n: 1 });
  };

  for (const user of db.users ?? []) add(user.transport);
  for (const order of db.orders ?? []) {
    add(order.transport);
    add(order.packingSlip?.transport);
  }

  return [...counts.values()]
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
    .slice(0, MAX_SUGGESTIONS)
    .map((entry) => entry.label);
}
