import assert from "node:assert/strict";
import test from "node:test";
import type { Driver } from "neo4j-driver";
import {
  discussionListIndexStatements,
  ensureDiscussionListIndexes,
} from "./discussionListIndexes.js";

test("provisions the forum-list lookup index and closes its session", async () => {
  const statements: string[] = [];
  let closeCalls = 0;
  const driver = {
    session: () => ({
      run: async (statement: string) => {
        statements.push(statement);
      },
      close: async () => {
        closeCalls += 1;
      },
    }),
  } as unknown as Driver;

  await ensureDiscussionListIndexes(driver);

  assert.deepEqual(
    { statements, closeCalls },
    {
      statements: [...discussionListIndexStatements],
      closeCalls: 1,
    }
  );
});
