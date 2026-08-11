import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

/**
 * Only pages a logged-out visitor actually receives. `/catalog` is excluded
 * because it redirects guests to the login landing.
 */
const PUBLIC_PATHS = ["", "/price-list", "/help"];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const now = new Date();

  return PUBLIC_PATHS.map((path) => ({
    url: `${base}/en${path}`,
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: path === "" ? 1 : 0.7,
    alternates: {
      languages: {
        en: `${base}/en${path}`,
        hi: `${base}/hi${path}`,
      },
    },
  }));
}
