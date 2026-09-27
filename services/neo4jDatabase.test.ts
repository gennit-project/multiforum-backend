import assert from "node:assert/strict";
import test from "node:test";
import type { Driver, SessionConfig } from "neo4j-driver";
import {
  DEFAULT_NEO4J_DATABASE,
  installDefaultNeo4jDatabase,
  resolveNeo4jDatabase,
} from "./neo4jDatabase.js";

test("resolveNeo4jDatabase uses the configured database", () => {
  assert.equal(resolveNeo4jDatabase(" topical "), "topical");
});

test("resolveNeo4jDatabase falls back to neo4j", () => {
  assert.equal(resolveNeo4jDatabase("  "), DEFAULT_NEO4J_DATABASE);
});

test("installDefaultNeo4jDatabase adds the database to sessions", () => {
  const calls: Array<SessionConfig | undefined> = [];
  const driver = {
    session: (config?: SessionConfig) => {
      calls.push(config);
      return {};
    },
  } as unknown as Driver;

  installDefaultNeo4jDatabase(driver, "forum");
  driver.session({ defaultAccessMode: "READ" });

  assert.deepEqual(calls, [
    { database: "forum", defaultAccessMode: "READ" },
  ]);
});

test("installDefaultNeo4jDatabase preserves an explicit database", () => {
  const calls: Array<SessionConfig | undefined> = [];
  const driver = {
    session: (config?: SessionConfig) => {
      calls.push(config);
      return {};
    },
  } as unknown as Driver;

  installDefaultNeo4jDatabase(driver, "forum");
  driver.session({ database: "system" });

  assert.deepEqual(calls, [{ database: "system" }]);
});
