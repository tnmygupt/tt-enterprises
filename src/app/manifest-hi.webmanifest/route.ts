import { NextResponse } from "next/server";
import manifest from "../manifest";

/**
 * Hindi home-screen install: same app, but launching lands on /hi so the
 * dealer does not have to switch language on every cold start.
 */
export function GET() {
  const base = manifest();
  return NextResponse.json(
    {
      ...base,
      id: "/hi",
      start_url: "/hi?v=4&source=pwa",
      lang: "hi",
      dir: "ltr",
    },
    {
      headers: {
        "Content-Type": "application/manifest+json",
        "Cache-Control": "public, max-age=0, must-revalidate",
      },
    }
  );
}
