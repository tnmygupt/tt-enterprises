import { describe, expect, it, beforeEach } from "vitest";
import {
  decodeJwtPayload,
  getRealtimePublicConfig,
  isSafeRealtimeBrowserKey,
  livePulseUpdatedAt,
  realtimeBroadcastUrl,
  rememberLiveConfig,
  resetLiveConfigForTests,
  shouldPullFromLivePulse,
} from "./live";

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function fakeJwt(role: string): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "none", typ: "JWT" })
  ).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ role })).toString("base64url");
  return `${header}.${payload}.x`;
}

describe("live payments desk helpers", () => {
  beforeEach(() => {
    resetLiveConfigForTests();
  });

  it("builds the Realtime REST broadcast URL", () => {
    expect(realtimeBroadcastUrl("https://abc.supabase.co/")).toBe(
      "https://abc.supabase.co/realtime/v1/api/broadcast/tt-app-db/events/changed"
    );
  });

  it("refuses service-role keys in the browser", () => {
    expect(isSafeRealtimeBrowserKey(fakeJwt("service_role"))).toBe(false);
    expect(isSafeRealtimeBrowserKey("sb_secret_abc")).toBe(false);
    expect(isSafeRealtimeBrowserKey(fakeJwt("anon"))).toBe(true);
    expect(isSafeRealtimeBrowserKey("sb_publishable_abc")).toBe(true);
    expect(decodeJwtPayload(fakeJwt("anon"))?.role).toBe("anon");
  });

  it("reads updatedAt from a broadcast payload", () => {
    expect(
      livePulseUpdatedAt({ payload: { updatedAt: "2026-08-24T06:00:00.000Z" } })
    ).toBe("2026-08-24T06:00:00.000Z");
    expect(livePulseUpdatedAt({ updatedAt: "x" })).toBe("x");
    expect(livePulseUpdatedAt({})).toBeNull();
  });

  it("skips a pull when this tab already has that stamp", () => {
    expect(shouldPullFromLivePulse(null, "a")).toBe(true);
    expect(shouldPullFromLivePulse("a", null)).toBe(true);
    expect(shouldPullFromLivePulse("a", "a")).toBe(false);
    expect(shouldPullFromLivePulse("a", "b")).toBe(true);
  });

  it("never hands a service-role key to the browser", () => {
    const prev = {
      url: process.env.SUPABASE_URL,
      nextUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      anon: process.env.SUPABASE_ANON_KEY,
      nextAnon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      api: process.env.SUPABASE_API_KEY,
    };
    try {
      process.env.SUPABASE_URL = "https://abc.supabase.co";
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.SUPABASE_ANON_KEY;
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      process.env.SUPABASE_API_KEY = fakeJwt("service_role");
      expect(getRealtimePublicConfig()).toBeNull();
      process.env.SUPABASE_API_KEY = fakeJwt("anon");
      expect(getRealtimePublicConfig()).toBeNull();
    } finally {
      restoreEnv("SUPABASE_URL", prev.url);
      restoreEnv("NEXT_PUBLIC_SUPABASE_URL", prev.nextUrl);
      restoreEnv("SUPABASE_ANON_KEY", prev.anon);
      restoreEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", prev.nextAnon);
      restoreEnv("SUPABASE_API_KEY", prev.api);
    }
  });

  it("caches only a safe live config", () => {
    expect(
      rememberLiveConfig({
        url: "https://abc.supabase.co",
        key: fakeJwt("service_role"),
      })
    ).toBeNull();
    expect(
      rememberLiveConfig({
        url: "https://abc.supabase.co",
        key: fakeJwt("anon"),
      })
    ).toEqual({
      url: "https://abc.supabase.co",
      key: fakeJwt("anon"),
    });
  });
});
