/** Canonical public origin, used for SEO metadata, sitemap and share links. */
export function siteUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    "https://tanmayphotos.space";
  return raw.replace(/\/+$/, "");
}
