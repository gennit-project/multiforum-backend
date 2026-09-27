import assert from "node:assert/strict";
import test from "node:test";
import type { Driver } from "neo4j-driver";
import {
  coreSchemaConstraintStatements,
  ensureCoreSchemaConstraints,
} from "./coreSchemaConstraints.js";

test("core constraints include unique keys for both issue counters", () => {
  const statements = coreSchemaConstraintStatements.join("\n");
  assert.deepEqual({
    channelCounter: statements.includes(
      "counter.channelUniqueName IS NODE KEY"
    ),
    serverCounter: statements.includes("counter.scope IS NODE KEY"),
  }, {
    channelCounter: true,
    serverCounter: true,
  });
});

test("ensureCoreSchemaConstraints uses one session and always closes it", async () => {
  const calls: string[] = [];
  const driver = {
    session: () => ({
      run: async (statement: string) => calls.push(statement),
      close: async () => calls.push("closed"),
    }),
  } as unknown as Driver;

  await ensureCoreSchemaConstraints(driver);

  assert.deepEqual({
    statements: calls.filter((call) => call !== "closed").length,
    closes: calls.filter((call) => call === "closed").length,
  }, {
    statements: coreSchemaConstraintStatements.length,
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

  await assert.rejects(() => ensureCoreSchemaConstraints(driver), /constraint failed/);
  assert.equal(closed, true);
});
