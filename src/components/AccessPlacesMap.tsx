"use client";

import { useEffect, useRef } from "react";
import type { PlacePin } from "@/lib/tracking-matrix";

type Props = {
  pins: PlacePin[];
  focusKey?: string | null;
  height?: number;
};

/**
 * OpenStreetMap + Leaflet map for access places (no Google API key).
 */
export function AccessPlacesMap({ pins, focusKey, height = 360 }: Props) {
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const layerRef = useRef<import("leaflet").LayerGroup | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!mapEl.current || mapRef.current) return;
      const L = (await import("leaflet")).default;
      // CSS for markers
      await import("leaflet/dist/leaflet.css");

      // Fix default marker icons under bundlers
      const icon = L.icon({
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        iconRetinaUrl:
          "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        shadowUrl:
          "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41],
      });
      L.Marker.prototype.options.icon = icon;

      if (cancelled || !mapEl.current) return;
      const map = L.map(mapEl.current, {
        scrollWheelZoom: false,
        attributionControl: true,
      }).setView([22.5, 79], 4.5);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
      }).addTo(map);
      const layer = L.layerGroup().addTo(map);
      mapRef.current = map;
      layerRef.current = layer;
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        layerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    void (async () => {
      const L = (await import("leaflet")).default;
      layer.clearLayers();
      if (!pins.length) {
        map.setView([22.5, 79], 4.5);
        return;
      }
      const bounds: import("leaflet").LatLngExpression[] = [];
      for (const p of pins) {
        const marker = L.marker([p.lat, p.lng]);
        marker.bindPopup(
          `<strong>${escapeHtml(p.city)}</strong>` +
            (p.region ? `<br/>${escapeHtml(p.region)}` : "") +
            (p.country ? `, ${escapeHtml(p.country)}` : "") +
            `<br/>${p.count} access` +
            (p.sampleName ? `<br/>${escapeHtml(p.sampleName)}` : "") +
            `<br/><span style="opacity:.7">${escapeHtml(p.sources.join(", "))}</span>`
        );
        (marker as unknown as { __pinKey?: string }).__pinKey = p.key;
        marker.addTo(layer);
        bounds.push([p.lat, p.lng]);
      }
      if (focusKey) {
        const pin = pins.find((x) => x.key === focusKey);
        if (pin) {
          map.setView([pin.lat, pin.lng], 8);
          layer.eachLayer((ly) => {
            const m = ly as import("leaflet").Marker & { __pinKey?: string };
            if (m.__pinKey === focusKey && m.openPopup) m.openPopup();
          });
          return;
        }
      }
      if (bounds.length === 1) {
        map.setView(bounds[0] as [number, number], 7);
      } else {
        map.fitBounds(bounds as [number, number][], { padding: [28, 28] });
      }
    })();
  }, [pins, focusKey]);

  return (
    <div
      ref={mapEl}
      className="w-full overflow-hidden rounded-xl border border-[var(--line)]"
      style={{ height }}
    />
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
