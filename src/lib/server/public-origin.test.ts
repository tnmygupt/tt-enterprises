import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { isPrivateHost, publicOrigin, wwwApexRedirect } from "./public-origin";

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

  it("redirects the expired tanmayphotos hosts onto the app hostname", () => {
    const res = wwwApexRedirect(
      req("https://www.tanmayphotos.space/en/admin", {
        host: "www.tanmayphotos.space",
        "x-forwarded-host": "www.tanmayphotos.space",
        "x-forwarded-proto": "https",
      })
    );
    expect(res).not.toBeNull();
    expect(res?.status).toBe(308);
    expect(res?.headers.get("location")).toBe(
      "https://app.ttenterprises.shop/en/admin"
    );
    const apex = wwwApexRedirect(
      req("https://tanmayphotos.space/en?v=4", {
        host: "tanmayphotos.space",
        "x-forwarded-host": "tanmayphotos.space",
        "x-forwarded-proto": "https",
      })
    );
    expect(apex?.headers.get("location")).toBe(
      "https://app.ttenterprises.shop/en?v=4"
    );
    expect(
      wwwApexRedirect(
        req("https://app.ttenterprises.shop/en", {
          host: "app.ttenterprises.shop",
          "x-forwarded-host": "app.ttenterprises.shop",
        })
      )
    ).toBeNull();
  });
});
