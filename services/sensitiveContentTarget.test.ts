import assert from "node:assert/strict";
import test from "node:test";
import type { Driver } from "neo4j-driver";
import { isSensitiveContentTarget } from "./sensitiveContentTarget.js";

const createDriver = (sensitive: boolean) => {
  let capturedParams: Record<string, unknown> | undefined;
  let closed = false;
  const driver = {
    session: () => ({
      run: async (_query: string, params: Record<string, unknown>) => {
        capturedParams = params;
        return { records: [{ get: () => sensitive }] };
      },
      close: async () => { closed = true; },
    }),
  } as unknown as Driver;
  return { driver, state: () => ({ capturedParams, closed }) };
};

test("checks every supported target using bound nullable parameters", async () => {
  const { driver, state } = createDriver(true);
  assert.equal(await isSensitiveContentTarget(driver, { commentId: "c-1" }), true);
  assert.deepEqual(state(), {
    capturedParams: {
      discussionId: null,
      commentId: "c-1",
      imageId: null,
      issueId: null,
      downloadableFileId: null,
    },
    closed: true,
  });
});

test("returns false when the target is not sensitive", async () => {
  const { driver } = createDriver(false);
  assert.equal(await isSensitiveContentTarget(driver, { discussionId: "d-1" }), false);
});

test("follows feedback-on-comment relationships into sensitive discussions", async () => {
  let query = "";
  const driver = {
    session: () => ({
      run: async (source: string) => {
        query = source;
        return { records: [{ get: () => false }] };
      },
      close: async () => undefined,
    }),
  } as unknown as Driver;

  await isSensitiveContentTarget(driver, { commentId: "feedback-1" });
  assert.match(
    query,
    /HAS_FEEDBACK_COMMENT.*IS_REPLY_TO\*0\.\..*CONTAINS_COMMENT/s
  );
});
