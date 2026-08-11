"use client";

import Image from "next/image";

type Props = {
  src?: string | null;
  alt: string;
  width: number;
  height: number;
  className?: string;
  /** Prefer eager for above-the-fold thumbs */
  priority?: boolean;
};

function usableSrc(src?: string | null): string {
  const s = (src || "").trim();
  if (!s) return "";
  if (s.startsWith("data:")) return s;
  if (s.startsWith("/") || /^https?:\/\//i.test(s)) return s;
  return "";
}

/**
 * Product thumbs via next/image when the URL is http(s) or a local path.
 * Falls back to a plain <img> for data-URLs (not supported by the optimizer).
 */
export function ProductImage({
  src,
  alt,
  width,
  height,
  className,
  priority,
}: Props) {
  const url = usableSrc(src);
  if (!url) {
    return (
      <span
        className={className}
        style={{
          display: "inline-flex",
          width,
          height,
          alignItems: "center",
          justifyContent: "center",
          background: "#eef0f3",
          color: "var(--ink-muted)",
          fontSize: 12,
          fontWeight: 700,
        }}
        aria-hidden
      >
        {alt.slice(0, 2).toUpperCase() || "—"}
      </span>
    );
  }
  if (url.startsWith("data:")) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={alt}
        width={width}
        height={height}
        className={className}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
      />
    );
  }
  return (
    <Image
      src={url}
      alt={alt}
      width={width}
      height={height}
      className={className}
      sizes={`${width}px`}
      priority={priority}
    />
  );
}
