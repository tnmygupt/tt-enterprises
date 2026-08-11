import type { LocalizedString } from "./types";

/** Never throw — always return a safe { en, hi } pair. */
export function normalizeLocalized(
  value: LocalizedString | null | undefined,
  fallbackEn = ""
): LocalizedString {
  const en = String(value?.en ?? fallbackEn ?? "").slice(0, 2000);
  const hi = String(value?.hi ?? "").slice(0, 2000);
  return { en, hi: hi || en };
}

function fallbackLocalized(fields: LocalizedString[]): LocalizedString[] {
  return fields.map((f) => normalizeLocalized(f));
}

const CHUNK = 15;
const FETCH_MS = 25_000;

async function postTranslateChunk(
  fields: LocalizedString[]
): Promise<LocalizedString[] | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const res = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields }),
      signal: ctrl.signal,
      credentials: "include",
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as {
      fields?: unknown;
    } | null;
    if (!data || !Array.isArray(data.fields)) return null;
    return data.fields.map((f, i) =>
      normalizeLocalized(
        f as LocalizedString,
        fields[i]?.en || ""
      )
    );
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fill empty Hindi via /api/translate.
 * Iron-clad: never throws; always returns the same length as input.
 */
export async function autoFillLocalized(
  fields: LocalizedString[]
): Promise<LocalizedString[]> {
  if (!fields.length) return [];
  const input = fields.map((f) => normalizeLocalized(f));
  const out: LocalizedString[] = [];

  for (let start = 0; start < input.length; start += CHUNK) {
    const chunk = input.slice(start, start + CHUNK);
    const translated = await postTranslateChunk(chunk);
    if (!translated || translated.length !== chunk.length) {
      out.push(...fallbackLocalized(chunk));
      continue;
    }
    out.push(...translated);
  }

  // Absolute guarantee — length match
  if (out.length !== input.length) {
    return fallbackLocalized(input);
  }
  return out;
}

export async function autoFillOne(
  field: LocalizedString
): Promise<LocalizedString> {
  try {
    const [out] = await autoFillLocalized([field]);
    return normalizeLocalized(out, field.en);
  } catch {
    return normalizeLocalized(field);
  }
}
