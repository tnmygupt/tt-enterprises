"use client";

import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
import { Link } from "@/i18n/routing";
import {
  VIDEO_RECORDING_SCRIPTS,
  type HelpGuide,
} from "@/lib/help-guides";

function youtubeEmbedUrl(raw: string): string | null {
  const url = raw.trim();
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) {
      const id = u.pathname.replace(/^\//, "");
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (u.hostname.includes("youtube.com")) {
      const id = u.searchParams.get("v");
      if (id) return `https://www.youtube.com/embed/${id}`;
      const parts = u.pathname.split("/");
      const embedIdx = parts.indexOf("embed");
      if (embedIdx >= 0 && parts[embedIdx + 1]) {
        return `https://www.youtube.com/embed/${parts[embedIdx + 1]}`;
      }
    }
  } catch {
    /* not a URL */
  }
  return null;
}

function WalkthroughPlayer({
  guide,
  playing,
  onPlayingChange,
  locale,
}: {
  guide: HelpGuide;
  playing: boolean;
  onPlayingChange: (v: boolean) => void;
  locale: "en" | "hi";
}) {
  const [index, setIndex] = useState(0);
  const step = guide.steps[index];
  const total = guide.steps.length;
  const progress = ((index + 1) / total) * 100;
  const hi = locale === "hi";

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setIndex((i) => {
        if (i >= total - 1) {
          onPlayingChange(false);
          return i;
        }
        return i + 1;
      });
    }, 5500);
    return () => window.clearInterval(id);
  }, [playing, total, onPlayingChange]);

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--brand-deep)] text-white shadow-sm">
      <div className="relative aspect-[16/10] sm:aspect-[16/9]">
        <div
          className="absolute inset-0 opacity-40"
          style={{
            background:
              "radial-gradient(ellipse at 20% 20%, #ff3131 0%, transparent 55%), radial-gradient(ellipse at 80% 80%, #c21818 0%, #4a0d0d 70%)",
          }}
        />
        <div className="relative z-[1] flex h-full flex-col justify-between p-5 sm:p-8">
          <div className="flex items-center justify-between gap-3 text-[11px] font-bold uppercase tracking-wider text-white/70">
            <span>{guide.videoLabel}</span>
            <span>
              {index + 1} / {total}
            </span>
          </div>
          <div className="max-w-xl">
            <p className="tt-display text-2xl leading-tight sm:text-3xl">
              {step.title}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-white/90 sm:text-base">
              {step.body}
            </p>
            {step.tip ? (
              <p className="mt-3 rounded-lg bg-white/10 px-3 py-2 text-xs text-white/85">
                {step.tip}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-md bg-white px-4 py-2 text-sm font-bold text-[var(--brand-deep)]"
              onClick={() => onPlayingChange(!playing)}
            >
              {playing
                ? hi
                  ? "रोकें"
                  : "Pause"
                : hi
                  ? "चलाएँ"
                  : "Play"}
            </button>
            <button
              type="button"
              className="rounded-md border border-white/40 px-3 py-2 text-sm font-semibold text-white"
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
            >
              ←
            </button>
            <button
              type="button"
              className="rounded-md border border-white/40 px-3 py-2 text-sm font-semibold text-white"
              onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}
            >
              →
            </button>
            <button
              type="button"
              className="rounded-md border border-white/40 px-3 py-2 text-xs font-semibold text-white/90"
              onClick={() => {
                setIndex(0);
                onPlayingChange(true);
              }}
            >
              {hi ? "फिर से" : "Restart"}
            </button>
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
          <div
            className="h-full bg-[var(--accent,#c4a35a)] transition-[width] duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}

export function HelpGuideView({
  guide,
  youtubeUrl,
  showRecordingScript = false,
  secondaryHref,
  secondaryLabel,
}: {
  guide: HelpGuide;
  youtubeUrl?: string;
  showRecordingScript?: boolean;
  secondaryHref?: string;
  secondaryLabel?: string;
}) {
  const locale = useLocale() as "en" | "hi";
  const [tab, setTab] = useState<"video" | "read">("video");
  const [playing, setPlaying] = useState(false);
  const embed = youtubeUrl ? youtubeEmbedUrl(youtubeUrl) : null;
  const script =
    guide.id === "dealer"
      ? VIDEO_RECORDING_SCRIPTS.dealer
      : guide.id === "accounts"
        ? VIDEO_RECORDING_SCRIPTS.accounts
        : VIDEO_RECORDING_SCRIPTS.admin;
  const hi = locale === "hi";

  return (
    <div className="space-y-8">
      <header className="max-w-2xl">
        <p className="text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">
          {guide.durationHint}
        </p>
        <h1 className="tt-display mt-1 text-3xl text-[var(--brand-deep)] sm:text-4xl">
          {guide.title}
        </h1>
        <p className="mt-2 text-sm text-[var(--ink-muted)] sm:text-base">
          {guide.subtitle}
        </p>
        {secondaryHref && secondaryLabel ? (
          <Link
            href={secondaryHref}
            className="mt-3 inline-flex text-sm font-semibold text-[var(--brand-deep)] underline"
          >
            {secondaryLabel}
          </Link>
        ) : null}
      </header>

      <div className="flex gap-2">
        <button
          type="button"
          className={`rounded-lg px-4 py-2 text-sm font-bold ${
            tab === "video"
              ? "bg-[var(--brand)] text-white"
              : "border border-[var(--line)] bg-white text-[var(--ink-muted)]"
          }`}
          onClick={() => setTab("video")}
        >
          {guide.videoLabel}
        </button>
        <button
          type="button"
          className={`rounded-lg px-4 py-2 text-sm font-bold ${
            tab === "read"
              ? "bg-[var(--brand)] text-white"
              : "border border-[var(--line)] bg-white text-[var(--ink-muted)]"
          }`}
          onClick={() => setTab("read")}
        >
          {guide.writtenLabel}
        </button>
      </div>

      {tab === "video" ? (
        <div className="space-y-4">
          {embed ? (
            <div className="aspect-video overflow-hidden rounded-2xl border border-[var(--line)] bg-black">
              <iframe
                title={guide.title}
                src={embed}
                className="h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          ) : (
            <WalkthroughPlayer
              guide={guide}
              playing={playing}
              onPlayingChange={setPlaying}
              locale={locale}
            />
          )}
          {!embed ? (
            <p className="text-xs text-[var(--ink-muted)]">
              {hi
                ? "इस पेज पर इन-ऐप वॉकथ्रू चलता है। YouTube अपलोड के बाद Admin → Settings में लिंक डालें — वह इस प्लेयर की जगह आ जाएगा।"
                : "Built-in walkthrough plays here. After you upload to YouTube, paste the link in Admin → Settings — it replaces this player."}
            </p>
          ) : null}
        </div>
      ) : (
        <ol className="space-y-4">
          {guide.steps.map((s) => (
            <li
              key={s.title}
              className="rounded-2xl border border-[var(--line)] bg-white p-4 sm:p-5"
            >
              <h2 className="text-base font-bold text-[var(--brand-deep)] sm:text-lg">
                {s.title}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-[var(--ink)]">
                {s.body}
              </p>
              {s.tip ? (
                <p className="mt-2 rounded-lg bg-[var(--brand-soft)] px-3 py-2 text-xs font-medium text-[var(--brand-deep)]">
                  {s.tip}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      {showRecordingScript ? (
        <section className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface)] p-4 sm:p-5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--ink-muted)]">
            {hi ? "स्क्रीन-रिकॉर्ड स्क्रिप्ट" : "Screen-record script"}
          </h2>
          <p className="mt-1 text-sm font-semibold text-[var(--ink)]">
            {script.title}
          </p>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-[var(--ink-muted)]">
            {script.beats.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
