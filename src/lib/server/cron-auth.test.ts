import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { authorizeCron } from "./cron-auth";
import { resetServerCfgCache } from "./read-cfg";

function req(url: string, headers?: HeadersInit): NextRequest {
  return new NextRequest(url, { headers });
}

describe("authorizeCron", () => {
  const prev = process.env.CRON_SECRET;

  beforeEach(() => {
    resetServerCfgCache();
    process.env.CRON_SECRET = "unit-test-cron-secret";
  });

  afterEach(() => {
    resetServerCfgCache();
    if (prev === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prev;
  });

  it("rejects when no secret is sent", () => {
    expect(authorizeCron(req("http://localhost/api/cron/reorder"))).toBe(false);
  });

  it("accepts Bearer", () => {
    expect(
      authorizeCron(
        req("http://localhost/api/cron/reorder", {
          authorization: "Bearer unit-test-cron-secret",
        })
      )
    ).toBe(true);
  });

  it("accepts ?secret=", () => {
    expect(
      authorizeCron(
        req("http://localhost/api/cron/whatsapp-digest?secret=unit-test-cron-secret")
      )
    ).toBe(true);
  });

  it("rejects the wrong secret", () => {
    expect(
      authorizeCron(req("http://localhost/api/cron/reorder?secret=nope"))
    ).toBe(false);
  });
});
