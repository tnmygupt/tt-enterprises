import type { MetadataRoute } from "next";

const brandName = process.env.NEXT_PUBLIC_BRAND_NAME || "TT Enterprises";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: brandName,
    short_name: "TT",
    description:
      "Wholesale tarpaulin, tirpal and shade net — orders, dispatch and dealer portal.",
    // Include v=4 so PWA launch bypasses Hostinger CDN HTML poison
    start_url: "/en?v=4&source=pwa",
    scope: "/",
    display: "standalone",
    // Do NOT set orientation — unsupported on iOS and can break home-screen launch
    background_color: "#f4f7f8",
    theme_color: "#0b7ea4",
    categories: ["business", "shopping"],
    icons: [
      {
        src: "/brand/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
