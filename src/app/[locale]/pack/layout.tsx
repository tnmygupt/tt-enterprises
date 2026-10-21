import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { absolute: "Packing" },
  robots: { index: false, follow: false },
};

export default function PackLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
