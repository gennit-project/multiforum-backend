import assert from "node:assert/strict";
import test from "node:test";
import type { Driver } from "neo4j-driver";
import {
  coreSchemaConstraintStatements,
  ensureCoreSchemaConstraints,
  getCoreSchemaConstraintStatements,
} from "./coreSchemaConstraints.js";

test("Enterprise uses node keys where property existence can be enforced", () => {
  const statements = getCoreSchemaConstraintStatements("enterprise");
  // 18 composite core constraints (13 NODE KEY + 5 UNIQUE) plus the 48
  // single-field uniqueness constraints that replaced the removed `@unique`
  // directive (always IS UNIQUE, never NODE KEY). Added since the base: the
  // per-forum discussion/event number constraints and channel counters, the
  // per-user image number (IS UNIQUE, owner-less images are null) and its
  // UserImageCounter (NODE KEY); the extra single-field UNIQUE is Comment.shortId.
  assert.equal(statements.length, 66);
  assert.equal(statements.filter((item) => item.includes("IS NODE KEY")).length, 13);
  assert.equal(statements.filter((item) => item.includes("IS UNIQUE")).length, 53);
});

test("Community uses supported uniqueness constraints for every identity", () => {
  const statements = getCoreSchemaConstraintStatements("community");
  assert.equal(statements.length, coreSchemaConstraintStatements.length);
  assert.equal(statements.every((item) => item.includes("IS UNIQUE")), true);
  assert.equal(statements.some((item) => item.includes("IS NODE KEY")), false);
  assert.equal(
    statements.every((item) => item.includes("IF NOT EXISTS")),
    true
  );
});

test("ensureCoreSchemaConstraints uses one session and always closes it", async () => {
  const calls: string[] = [];
  const driver = {
    session: () => ({
      run: async (statement: string) => calls.push(statement),
      close: async () => calls.push("closed"),
    }),
  } as unknown as Driver;

  await ensureCoreSchemaConstraints(driver, "community");

  assert.deepEqual({
    statements: calls.filter((call) => call !== "closed"),
    closes: calls.filter((call) => call === "closed").length,
  }, {
    statements: getCoreSchemaConstraintStatements("community"),
    closes: 1,
  });
});

test("ensureCoreSchemaConstraints closes its session when creation fails", async () => {
  let closed = false;
  const driver = {
    session: () => ({
      run: async () => {
        throw new Error("constraint failed");
      },
      close: async () => {
        closed = true;
      },
    }),
  } as unknown as Driver;

  await assert.rejects(
    () => ensureCoreSchemaConstraints(driver, "enterprise"),
    /constraint failed/
  );
  assert.equal(closed, true);
});
