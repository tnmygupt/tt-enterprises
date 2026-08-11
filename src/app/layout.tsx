import type { Metadata } from "next";
import { siteUrl } from "@/lib/site";

const brandName = process.env.NEXT_PUBLIC_BRAND_NAME || "TT Enterprises";
const description =
  "Wholesale tarpaulin, tirpal and shade net supplier for dealers — live rates, order tracking and dispatch updates.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: `${brandName} — Wholesale Tarpaulin, Tirpal & Shade Net`,
    template: `%s · ${brandName}`,
  },
  description,
  applicationName: brandName,
  keywords: [
    "tarpaulin wholesale",
    "tirpal supplier",
    "shade net",
    "HDPE tarpaulin",
    "B2B tarpaulin dealer",
  ],
  alternates: {
    canonical: "/en",
    languages: { en: "/en", hi: "/hi" },
  },
  openGraph: {
    type: "website",
    siteName: brandName,
    title: `${brandName} — Wholesale Tarpaulin, Tirpal & Shade Net`,
    description,
    url: "/en",
  },
  twitter: {
    card: "summary",
    title: brandName,
    description,
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: [
      { url: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/brand/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: brandName,
    statusBarStyle: "default",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
