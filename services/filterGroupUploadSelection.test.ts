import assert from "node:assert/strict";
import test from "node:test";
import type { Driver } from "neo4j-driver";
import {
  backfillFilterGroupUploadSelection,
  FILTER_GROUP_UPLOAD_SELECTION_BACKFILL,
} from "./filterGroupUploadSelection.js";

test("backfills legacy filter groups and closes its session", async () => {
  const statements: string[] = [];
  let closeCalls = 0;
  const driver = {
    session: () => ({
      run: async (statement: string) => {
        statements.push(statement);
        return {
          records: [{ get: () => 3 }],
        };
      },
      close: async () => {
        closeCalls += 1;
      },
    }),
  } as unknown as Driver;

  const updated = await backfillFilterGroupUploadSelection(driver);

  assert.deepEqual(
    { statements, closeCalls, updated },
    {
      statements: [FILTER_GROUP_UPLOAD_SELECTION_BACKFILL],
      closeCalls: 1,
      updated: 3,
    }
  );
});

test("closes its session when the backfill fails", async () => {
  let closed = false;
  const driver = {
    session: () => ({
      run: async () => {
        throw new Error("backfill failed");
      },
      close: async () => {
        closed = true;
      },
    }),
  } as unknown as Driver;

  await assert.rejects(
    () => backfillFilterGroupUploadSelection(driver),
    /backfill failed/
  );
  assert.equal(closed, true);
});

test("reports zero when the backfill returns no count record", async () => {
  const driver = {
    session: () => ({
      run: async () => ({ records: [] }),
      close: async () => {},
    }),
  } as unknown as Driver;

  assert.equal(await backfillFilterGroupUploadSelection(driver), 0);
});
