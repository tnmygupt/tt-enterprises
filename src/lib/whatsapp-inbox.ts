/**
 * Leftover cloud field only. Team inbox UI/API is gone; browser GET still
 * must never see it, and PUT must not wipe the stored blob.
 */
export type WaInbox = {
  messages?: { id?: string }[];
  reads?: unknown[];
  pins?: { phone?: string }[];
  notes?: { text?: string }[];
};

export function omitWaInbox<T extends object>(db: T): T {
  const next = { ...db } as T & { waInbox?: WaInbox };
  delete next.waInbox;
  return next;
}
