import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { shouldOpenAppBridge } from "./open-app";

function req(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, { headers });
}

describe("shouldOpenAppBridge", () => {
  it("skips the bridge for same-origin in-app clicks", () => {
    expect(
      shouldOpenAppBridge(
        req("https://tanmayphotos.space/o/TT-104", {
          "sec-fetch-site": "same-origin",
        })
      )
    ).toBe(false);
  });

  it("uses the app-first page for WhatsApp / external taps", () => {
    expect(
      shouldOpenAppBridge(
        req("https://tanmayphotos.space/o/TT-104", {
          "sec-fetch-site": "none",
        })
      )
    ).toBe(true);
    expect(shouldOpenAppBridge(req("https://tanmayphotos.space/o/TT-104"))).toBe(
      true
    );
  });
});
