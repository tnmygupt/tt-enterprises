import { describe, expect, it } from "vitest";
import {
  isMysqlTransientError,
  publicDatabaseError,
  publicDatabaseMessage,
} from "./host-sql";

describe("MySQL error sanitizing", () => {
  it("retries dropped Hostinger sockets", () => {
    expect(
      isMysqlTransientError({ code: "PROTOCOL_CONNECTION_LOST", message: "x" })
    ).toBe(true);
    expect(isMysqlTransientError({ code: "ECONNRESET" })).toBe(true);
    expect(
      isMysqlTransientError({
        message: "Can't add new command when connection is in closed state",
      })
    ).toBe(true);
    expect(isMysqlTransientError({ code: "ER_DUP_ENTRY" })).toBe(false);
  });

  it("hides raw SQL from the browser", () => {
    expect(publicDatabaseError({ message: "PROTOCOL_CONNECTION_LOST" })).toBe(
      "Database is busy. Please retry."
    );
    expect(publicDatabaseMessage("ER_CON_COUNT_ERROR: Too many connections")).toBe(
      "Database is busy. Please retry."
    );
    expect(publicDatabaseMessage("No users in cloud database")).toBe(
      "No users in cloud database"
    );
  });
});
