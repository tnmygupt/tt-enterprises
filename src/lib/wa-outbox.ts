"use client";

export type WaOutboxItem = {
  id: string;
  phone: string;
  text: string;
  label?: string;
  createdAt: string;
};

const KEY = "tt_wa_outbox";

function canUseStorage(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

export function listWaOutbox(): WaOutboxItem[] {
  if (!canUseStorage()) return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as WaOutboxItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveWaOutbox(items: WaOutboxItem[]): void {
  if (!canUseStorage()) return;
  localStorage.setItem(KEY, JSON.stringify(items.slice(0, 40)));
  window.dispatchEvent(new Event("tt-wa-outbox-updated"));
}

export function enqueueWaOutbox(input: {
  phone: string;
  text: string;
  label?: string;
}): WaOutboxItem {
  const item: WaOutboxItem = {
    id: `wa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    phone: input.phone,
    text: input.text,
    label: input.label,
    createdAt: new Date().toISOString(),
  };
  const next = [item, ...listWaOutbox().filter((x) => x.phone !== input.phone || x.text !== input.text)];
  saveWaOutbox(next);
  return item;
}

export function removeWaOutbox(id: string): void {
  saveWaOutbox(listWaOutbox().filter((x) => x.id !== id));
}

export function clearWaOutbox(): void {
  saveWaOutbox([]);
}
