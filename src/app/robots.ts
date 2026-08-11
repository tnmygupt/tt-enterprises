import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: [
          "/",
          "/en",
          "/hi",
          "/en/price-list",
          "/hi/price-list",
          "/en/help",
          "/hi/help",
        ],
        disallow: [
          "/api/",
          "/en/admin",
          "/hi/admin",
          // Redirects guests to login — nothing for a crawler to index
          "/en/catalog",
          "/hi/catalog",
          "/en/orders",
          "/hi/orders",
          "/en/wallet",
          "/hi/wallet",
          "/en/checkout",
          "/hi/checkout",
          "/en/quick-order",
          "/hi/quick-order",
          "/en/schemes",
          "/hi/schemes",
        ],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
