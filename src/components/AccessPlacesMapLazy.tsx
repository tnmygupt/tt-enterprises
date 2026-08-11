"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { PlacePin } from "@/lib/tracking-matrix";

const AccessPlacesMap = dynamic(
  () => import("./AccessPlacesMap").then((m) => m.AccessPlacesMap),
  { ssr: false }
);

type Props = {
  pins: PlacePin[];
  focusKey?: string | null;
  height?: number;
};

/**
 * Leaflet plus OSM tiles are the heaviest thing on the tracking page, and the
 * map sits far below the fold — only mount it once it is actually scrolled to.
 */
export function AccessPlacesMapLazy({ pins, focusKey, height = 360 }: Props) {
  const holder = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = holder.current;
    if (!el || visible) return;
    if (typeof IntersectionObserver === "undefined") {
      // No observer support — just render the map
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
      },
      { rootMargin: "200px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  return (
    <div ref={holder}>
      {visible ? (
        <AccessPlacesMap pins={pins} focusKey={focusKey} height={height} />
      ) : (
        <div
          className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-2)]"
          style={{ height }}
        />
      )}
    </div>
  );
}
