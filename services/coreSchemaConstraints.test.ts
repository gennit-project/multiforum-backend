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
  assert.equal(statements.length, 9);
  assert.equal(statements.filter((item) => item.includes("IS NODE KEY")).length, 5);
  assert.equal(statements.filter((item) => item.includes("IS UNIQUE")).length, 4);
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
