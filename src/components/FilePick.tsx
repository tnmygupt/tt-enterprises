"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";

export type FilePickKind = "photo" | "photoOrPdf" | "media" | "qr";

const ACCEPT: Record<FilePickKind, string> = {
  photo:
    "image/jpeg,image/jpg,image/png,image/webp,image/*,.jpg,.jpeg,.png,.webp",
  photoOrPdf:
    "image/jpeg,image/jpg,image/png,image/webp,image/*,.jpg,.jpeg,.png,.webp,.pdf,application/pdf",
  media: "image/*,video/*",
  qr: "image/*",
};

function toList(value: File | File[] | null | undefined): File[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function isImageFile(file: File): boolean {
  const mime = (file.type || "").toLowerCase();
  if (mime.includes("heic") || mime.includes("heif")) return false;
  if (mime.startsWith("image/")) return true;
  return /\.(jpe?g|png|webp|gif|avif)$/i.test(file.name);
}

function isHeic(file: File): boolean {
  const mime = (file.type || "").toLowerCase();
  const name = file.name.toLowerCase();
  return mime.includes("heic") || mime.includes("heif") || /\.hei[cf]$/.test(name);
}

function fileAllowed(file: File, kind: FilePickKind): boolean {
  if (isHeic(file)) return false;
  const mime = (file.type || "").toLowerCase();
  const name = file.name.toLowerCase();
  // Some phone cameras send an empty MIME type.
  if (!mime) {
    if (kind === "photo" || kind === "qr") return !/\.pdf$/i.test(name);
    return true;
  }
  if (kind === "photoOrPdf") {
    return (
      mime.startsWith("image/") ||
      mime === "application/pdf" ||
      /\.(jpe?g|png|webp|gif|avif|pdf)$/i.test(name)
    );
  }
  if (kind === "photo" || kind === "qr") {
    return mime.startsWith("image/") || /\.(jpe?g|png|webp|gif|avif)$/i.test(name);
  }
  if (kind === "media") {
    return (
      mime.startsWith("image/") ||
      mime.startsWith("video/") ||
      /\.(jpe?g|png|webp|gif|avif|mp4|webm|mov|m4v)$/i.test(name)
    );
  }
  return true;
}

function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function CameraIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.3l.9-1.4A1.5 1.5 0 0 1 9.9 4h4.2a1.5 1.5 0 0 1 1.2.6L16.2 6h1.3A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-8Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <circle cx="12" cy="12.2" r="3.2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4.2l1.3 1.6H19a1.5 1.5 0 0 1 1.5 1.5V18A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18V7.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export type FilePickProps = {
  label?: string;
  hint?: string;
  kind?: FilePickKind;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  busy?: boolean;
  /** Show a phone-camera button (ignored for video-only). Default true for photos. */
  camera?: boolean;
  compact?: boolean;
  className?: string;
  id?: string;
  /** Selected files kept until the parent form submits. */
  value?: File | File[] | null;
  onChange?: (files: File[]) => void;
  /** Fire-and-forget pick (upload immediately). */
  onPick?: (files: File[]) => void | Promise<void>;
};

/**
 * Clear photo/file picker: camera + gallery buttons, preview, and remove.
 * Hides the native “Choose file” control that is hard to tap on phones.
 */
export function FilePick({
  label,
  hint,
  kind = "photoOrPdf",
  accept,
  multiple = false,
  disabled = false,
  busy = false,
  camera,
  compact = false,
  className = "",
  id,
  value,
  onChange,
  onPick,
}: FilePickProps) {
  const t = useTranslations("upload");
  const autoId = useId();
  const galleryId = `${id || autoId}-gallery`;
  const cameraId = `${id || autoId}-camera`;
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState("");
  const selected = toList(value);
  const selectedKey = selected.map(fileKey).join("|");
  const [previews, setPreviews] = useState<string[]>([]);
  const showCamera = camera ?? kind !== "media";
  const acceptAttr = accept || ACCEPT[kind];
  const locked = disabled || busy;

  useEffect(() => {
    const list = toList(value);
    const urls = list.map((f) =>
      isImageFile(f) ? URL.createObjectURL(f) : ""
    );
    setPreviews(urls);
    return () => {
      urls.forEach((u) => {
        if (u) URL.revokeObjectURL(u);
      });
    };
  }, [selectedKey, value]);

  const chooseLabel =
    kind === "photo"
      ? t("choosePhoto")
      : kind === "qr"
        ? t("chooseQr")
        : kind === "media"
          ? t("chooseMedia")
          : t("choosePhotoOrPdf");

  const defaultHint =
    kind === "photo"
      ? t("hintPhoto")
      : kind === "qr"
        ? t("hintQr")
        : kind === "media"
          ? t("hintMedia")
          : t("hintPhotoOrPdf");

  const apply = (list: File[]) => {
    const allowed = list.filter((f) => fileAllowed(f, kind));
    if (!allowed.length) {
      setError(t("rejected"));
      return;
    }
    setError(allowed.length < list.length ? t("rejected") : "");
    const next = multiple
      ? [
          ...selected,
          ...allowed.filter(
            (f) => !selected.some((s) => fileKey(s) === fileKey(f))
          ),
        ]
      : allowed.slice(0, 1);
    if (!next.length) return;
    if (onPick) void onPick(multiple ? allowed : next);
    else onChange?.(next);
  };

  const onInput = (el: HTMLInputElement) => {
    const list = Array.from(el.files || []);
    el.value = "";
    apply(list);
  };

  const clear = () => onChange?.([]);

  const grow = compact ? "" : "flex-1 sm:flex-none";
  const galleryCaption = busy
    ? t("uploading")
    : selected.length && !onPick
      ? multiple
        ? t("addMore")
        : t("replace")
      : chooseLabel;
  const buttons = (
    <div className="flex flex-wrap gap-2">
      {showCamera ? (
        <button
          type="button"
          className={`tt-btn tt-btn-dark ${grow}`}
          disabled={locked}
          onClick={() => cameraRef.current?.click()}
        >
          <CameraIcon />
          {busy ? t("uploading") : t("takePhoto")}
        </button>
      ) : null}
      <button
        type="button"
        className={`${showCamera ? "tt-btn tt-btn-outline" : "tt-btn tt-btn-dark"} ${grow}`}
        disabled={locked}
        onClick={() => galleryRef.current?.click()}
      >
        <FolderIcon />
        {galleryCaption}
      </button>
    </div>
  );
  const typeError = error ? (
    <p className="mt-2 text-xs font-semibold text-[var(--danger)]" role="alert">
      {error}
    </p>
  ) : null;

  const inputs = (
    <>
      <input
        ref={galleryRef}
        id={galleryId}
        type="file"
        accept={acceptAttr}
        multiple={multiple}
        disabled={locked}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => onInput(e.target)}
      />
      {showCamera ? (
        <input
          ref={cameraRef}
          id={cameraId}
          type="file"
          accept={kind === "photoOrPdf" ? "image/*" : acceptAttr}
          capture="environment"
          disabled={locked}
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => onInput(e.target)}
        />
      ) : null}
    </>
  );

  const chips =
    !onPick && selected.length ? (
      <ul className="mt-3 space-y-2">
        {selected.map((file, i) => (
          <li
            key={`${file.name}-${file.size}-${file.lastModified}`}
            className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-white px-3 py-2"
          >
            {previews[i] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previews[i]}
                alt=""
                className="h-12 w-12 shrink-0 rounded-lg object-cover"
              />
            ) : (
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-2)] text-[10px] font-bold uppercase text-[var(--ink-muted)]">
                {file.name.split(".").pop() || t("file")}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-[var(--ink)]">
                {file.name}
              </p>
              <p className="text-xs text-[var(--ink-muted)]">
                {formatSize(file.size)}
              </p>
            </div>
            <button
              type="button"
              className="text-xs font-bold text-[var(--danger)] underline underline-offset-2"
              onClick={() => {
                if (multiple) {
                  onChange?.(selected.filter((_, j) => j !== i));
                } else {
                  clear();
                }
              }}
            >
              {t("remove")}
            </button>
          </li>
        ))}
      </ul>
    ) : null;

  if (compact) {
    return (
      <div className={className}>
        {label ? <p className="tt-label mb-2">{label}</p> : null}
        {inputs}
        {buttons}
        {typeError}
        {chips}
      </div>
    );
  }

  return (
    <div className={className}>
      {label ? <p className="tt-label">{label}</p> : null}
      {inputs}
      <div
        className={`mt-1 rounded-2xl border-2 border-dashed p-4 transition-colors ${
          drag
            ? "border-[var(--brand)] bg-[var(--brand-soft)]"
            : "border-[var(--line)] bg-[var(--surface-2)]"
        } ${locked ? "opacity-60" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!locked) setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (locked) return;
          apply(Array.from(e.dataTransfer.files || []));
        }}
      >
        {buttons}
        <p className="mt-2 text-xs text-[var(--ink-muted)]">
          {hint || defaultHint}
        </p>
        {typeError}
        {chips}
      </div>
    </div>
  );
}
