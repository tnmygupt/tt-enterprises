import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { Metadata, Viewport } from "next";
import { DM_Sans, Fraunces } from "next/font/google";
import { routing } from "@/i18n/routing";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { AuthRedirect } from "@/components/AuthRedirect";
import { ConnectionBanner } from "@/components/ConnectionBanner";
import { PwaRegister } from "@/components/PwaRegister";
import { TrafficBeacon } from "@/components/TrafficBeacon";
import "../globals.css";

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
});

const body = DM_Sans({
  subsets: ["latin"],
  variable: "--font-body",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#0b7ea4",
  // Helps Safari treat the layout width correctly with notches / safe areas
  interactiveWidget: "resizes-content",
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    manifest: locale === "hi" ? "/manifest-hi.webmanifest" : "/manifest.webmanifest",
  };
}

// Never let CDN pin HTML for a year (blank phone apps after deploy)
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!routing.locales.includes(locale as "en" | "hi")) {
    notFound();
  }
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <html lang={locale} className={`${display.variable} ${body.variable} h-full`}>
      <body className="flex min-h-full flex-col antialiased">
        <NextIntlClientProvider messages={messages}>
          <div className="tt-app-shell flex min-h-full flex-col">
            <AuthRedirect />
            <PwaRegister />
            <TrafficBeacon />
            <SiteHeader />
            <main className="flex-1">{children}</main>
            <ConnectionBanner />
            <SiteFooter />
          </div>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
