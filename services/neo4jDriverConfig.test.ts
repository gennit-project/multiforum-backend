import assert from "node:assert/strict";
import test from "node:test";
import {
  neo4jDriverConfig,
  NEO4J_CONNECTION_LIVENESS_CHECK_TIMEOUT_MS,
} from "./neo4jDriverConfig.js";

test("validates idle pooled Neo4j connections before reuse", () => {
  assert.equal(NEO4J_CONNECTION_LIVENESS_CHECK_TIMEOUT_MS, 30_000);
  assert.equal(
    neo4jDriverConfig.connectionLivenessCheckTimeout,
    NEO4J_CONNECTION_LIVENESS_CHECK_TIMEOUT_MS
  );
});
