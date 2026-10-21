import { mkdtemp, rm } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createPackSlipRecord,
  deletePackSlipRecord,
  listPackSlips,
  updatePackSlipRecord,
} from "./pack-slip-store";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "pack-slips-"));
  process.env.PACK_SLIP_FILE = path.join(dir, "slips.json");
  delete process.env.MYSQL_HOST;
  delete process.env.MYSQL_USER;
  delete process.env.MYSQL_PASSWORD;
  delete process.env.MYSQL_DATABASE;
});

afterEach(async () => {
  delete process.env.PACK_SLIP_FILE;
  await rm(dir, { recursive: true, force: true });
});

describe("pack slip store", () => {
  it("stores slips apart from shop orders", async () => {
    const first = await createPackSlipRecord({
      partyName: "Anyone",
      items: [{ name: "Anything", bundles: 2, rate: 5 }],
      weights: [[1, 2]],
      orderNumber: "TT-9",
    });
    const second = await createPackSlipRecord({
      partyName: "Second party",
      items: [{ name: "Boxes", bundles: 1 }],
    });
    expect(first.slipNo).toBe("PS-1001");
    expect(second.slipNo).toBe("PS-1002");
    expect(first).not.toHaveProperty("orderNumber");

    const saved = await updatePackSlipRecord(first.id, {
      ...first,
      weights: [[1.25, 2]],
    });
    expect(saved.weights[0]).toEqual([1.25, 2]);

    const locked = await updatePackSlipRecord(first.id, { ...saved, status: "finalized" });
    await expect(updatePackSlipRecord(first.id, { ...locked, partyName: "Nope" })).rejects.toThrow(
      /finalized/
    );
    await expect(deletePackSlipRecord(first.id)).rejects.toThrow(/finalized/);

    expect(await deletePackSlipRecord(second.id)).toBe(true);
    const left = await listPackSlips();
    expect(left.map((slip) => slip.id)).toEqual([locked.id]);
  });
});
