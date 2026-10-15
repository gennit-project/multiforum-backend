import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Driver } from "neo4j-driver";
import {
  Neo4jCdcConfigurationError,
  assertNeo4jCdcAvailable,
  createNeo4jCdcSubscriptionsEngine,
} from "./neo4jSubscriptions.js";

function driverWithResults(
  executeQuery: (...args: unknown[]) => Promise<unknown>
): Driver {
  return { executeQuery } as unknown as Driver;
}

describe("assertNeo4jCdcAvailable", () => {
  it("checks the CDC cursor and query permission in the selected database", async () => {
    const calls: unknown[][] = [];
    const driver = driverWithResults(async (...args: unknown[]) => {
      calls.push(args);
      if (calls.length === 1) {
        return {
          records: [
            {
              get: (key: string) =>
                key === "id" ? "cursor-1" : undefined,
            },
          ],
        };
      }
      return { records: [] };
    });

    await assertNeo4jCdcAvailable(driver, "forum");

    assert.deepEqual(calls, [
      ["CALL cdc.current() YIELD id RETURN id", {}, { database: "forum" }],
      [
        "CALL cdc.query($cursor) YIELD id RETURN id LIMIT 1",
        { cursor: "cursor-1" },
        { database: "forum" },
      ],
    ]);
  });

  it("reports disabled CDC with actionable setup guidance", async () => {
    const cause = new Error("Change Data Capture is not currently enabled");
    const driver = driverWithResults(async () => {
      throw cause;
    });

    await assert.rejects(
      assertNeo4jCdcAvailable(driver, "neo4j"),
      (error: unknown) => {
        assert.ok(error instanceof Neo4jCdcConfigurationError);
        assert.equal(error.cause, cause);
        assert.match(error.message, /Enable CDC in FULL mode/);
        assert.match(error.message, /cdc\.query/);
        return true;
      }
    );
  });

  it("rejects an empty CDC cursor before checking query permission", async () => {
    let calls = 0;
    const driver = driverWithResults(async () => {
      calls += 1;
      return { records: [] };
    });

    await assert.rejects(
      assertNeo4jCdcAvailable(driver, "neo4j"),
      /cdc\.current did not return a change identifier/
    );
    assert.equal(calls, 1);
  });
});

describe("createNeo4jCdcSubscriptionsEngine", () => {
  it("creates an engine that reads CDC from the selected database", () => {
    const driver = driverWithResults(async () => ({ records: [] }));

    const engine = createNeo4jCdcSubscriptionsEngine(driver, "forum");

    assert.equal(typeof engine.init, "function");
    assert.equal(typeof engine.close, "function");
    assert.equal(typeof engine.events.emit, "function");
  });
});
