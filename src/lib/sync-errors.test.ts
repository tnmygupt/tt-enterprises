import { describe, expect, it } from "vitest";
import {
  isDatabaseInfraMessage,
  isSessionAuthMessage,
  shouldRetrySessionCookieCheck,
} from "./sync-errors";

describe("sync error classifiers", () => {
  it("treats MySQL dropouts as database, not session expiry", () => {
    expect(isDatabaseInfraMessage("PROTOCOL_CONNECTION_LOST")).toBe(true);
    expect(isDatabaseInfraMessage("Too many connections")).toBe(true);
    expect(isDatabaseInfraMessage("Database is busy. Please retry.")).toBe(true);
    expect(isSessionAuthMessage("PROTOCOL_CONNECTION_LOST")).toBe(false);
    expect(
      isSessionAuthMessage("Login required to sync — please log in again")
    ).toBe(true);
  });

  it("still flags real session messages", () => {
    expect(
      isSessionAuthMessage("Admin login cookie missing — log in again to see new dealer signups.")
    ).toBe(true);
    expect(isSessionAuthMessage("Account removed. Please log in again.")).toBe(
      true
    );
    expect(isSessionAuthMessage("Account is disabled")).toBe(false);
  });

  it("retries a cookie-less 401 only when local session still exists", () => {
    expect(shouldRetrySessionCookieCheck(401, undefined, true)).toBe(true);
    expect(shouldRetrySessionCookieCheck(401, undefined, false)).toBe(false);
    expect(
      shouldRetrySessionCookieCheck(401, "Account removed. Please log in again.", true)
    ).toBe(false);
    expect(shouldRetrySessionCookieCheck(200, undefined, true)).toBe(false);
  });
});
