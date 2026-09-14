import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { isPrivateHost, publicOrigin } from "./public-origin";

function req(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, { headers });
}

describe("publicOrigin", () => {
  it("uses x-forwarded-host over the bind address", () => {
    expect(
      publicOrigin(
        req("https://0.0.0.0:3000/o/TT-104", {
          "x-forwarded-host": "tanmayphotos.space",
          "x-forwarded-proto": "https",
          host: "0.0.0.0:3000",
        })
      )
    ).toBe("https://tanmayphotos.space");
  });

  it("skips 0.0.0.0 and falls back to the public site url", () => {
    const origin = publicOrigin(
      req("https://0.0.0.0:3000/g/orders", { host: "0.0.0.0:3000" })
    );
    expect(origin).toMatch(/^https:\/\//);
    expect(origin).not.toContain("0.0.0.0");
  });

  it("flags private hosts", () => {
    expect(isPrivateHost("0.0.0.0:3000")).toBe(true);
    expect(isPrivateHost("127.0.0.1")).toBe(true);
    expect(isPrivateHost("tanmayphotos.space")).toBe(false);
  });
});
