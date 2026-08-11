import type { LocalizedString } from "./types";

/** Small glossary for common B2B terms (faster + more reliable). */
const GLOSSARY: Record<string, string> = {
  tarpaulin: "तिरपाल",
  "shade net": "शेड नेट",
  tirpal: "तिरपाल",
  blue: "नीला",
  green: "हरा",
  black: "काला",
  silver: "सिल्वर",
  white: "सफेद",
  yellow: "पीला",
  red: "लाल",
  standard: "स्टैंडर्ड",
  roll: "रोल",
  sheet: "शीट",
  bundle: "बंडल",
  bundles: "बंडल",
  width: "चौड़ाई",
  ft: "फीट",
  "dark green": "गहरा हरा",
  new: "नया",
  hdpe: "एचडीपीई",
  copy: "कॉपी",
};

function glossaryLookup(text: string): string | null {
  try {
    const key = text.trim().toLowerCase();
    if (!key) return null;
    if (GLOSSARY[key]) return GLOSSARY[key];
    let out = text;
    let hit = false;
    const parts = Object.keys(GLOSSARY).sort((a, b) => b.length - a.length);
    for (const en of parts) {
      const re = new RegExp(
        `\\b${en.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
        "gi"
      );
      if (re.test(out)) {
        out = out.replace(re, GLOSSARY[en]);
        hit = true;
      }
    }
    return hit ? out : null;
  } catch {
    return null;
  }
}

async function translateViaMyMemory(text: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
      text
    )}&langpair=en|hi`;
    const res = await fetch(url, {
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error("Translate request failed");
    const data = (await res.json()) as {
      responseData?: { translatedText?: string };
      responseStatus?: number;
    };
    const translated = data.responseData?.translatedText?.trim();
    if (!translated || data.responseStatus !== 200) {
      throw new Error("Translate empty");
    }
    if (/MYMEMORY WARNING/i.test(translated)) return text;
    return translated;
  } finally {
    clearTimeout(timer);
  }
}

/** Translate a single English string to Hindi. Never throws. */
export async function translateEnToHi(text: string): Promise<string> {
  try {
    const trimmed = String(text ?? "").trim();
    if (!trimmed) return "";
    // Skip pure numbers / codes — no translation needed
    if (/^[\d.\s\-_/xX×]+$/.test(trimmed)) return trimmed;
    const fromGlossary = glossaryLookup(trimmed);
    if (fromGlossary) return fromGlossary;
    try {
      return await translateViaMyMemory(trimmed);
    } catch {
      return trimmed;
    }
  } catch {
    return String(text ?? "");
  }
}

/** Fill empty Hindi from English for a localized pair. Never throws. */
export async function fillLocalizedHi(
  value: LocalizedString | undefined
): Promise<LocalizedString> {
  try {
    const en = String(value?.en ?? "");
    const hi = String(value?.hi ?? "").trim();
    if (!en.trim()) return { en, hi: String(value?.hi ?? "") };
    if (hi && hi !== en.trim()) return { en, hi: String(value?.hi ?? hi) };
    const translated = await translateEnToHi(en);
    return { en, hi: translated || en };
  } catch {
    const en = String(value?.en ?? "");
    return { en, hi: String(value?.hi || en) };
  }
}

/** Batch-fill many localized fields. Never throws; same length as input. */
export async function fillManyLocalizedHi(
  items: (LocalizedString | undefined)[]
): Promise<LocalizedString[]> {
  const out: LocalizedString[] = [];
  for (const item of items) {
    out.push(await fillLocalizedHi(item));
  }
  return out;
}
