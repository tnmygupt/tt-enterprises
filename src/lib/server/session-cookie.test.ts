import { describe, expect, it } from "vitest";
import { sessionCookieDomainFromHost } from "./session";

describe("sessionCookieDomainFromHost", () => {
  it("shares cookies across apex and www", () => {
    expect(sessionCookieDomainFromHost("tanmayphotos.space")).toBe(
      "tanmayphotos.space"
    );
    expect(sessionCookieDomainFromHost("www.tanmayphotos.space")).toBe(
      "tanmayphotos.space"
    );
    expect(
      sessionCookieDomainFromHost("www.tanmayphotos.space:443")
    ).toBe("tanmayphotos.space");
  });

  it("does not set a domain on localhost or preview hosts", () => {
    expect(sessionCookieDomainFromHost("localhost:3000")).toBeUndefined();
    expect(
      sessionCookieDomainFromHost("darkorange-parrot-791136.hostingersite.com")
    ).toBeUndefined();
  });
});
