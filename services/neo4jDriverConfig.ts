import type { Config } from "neo4j-driver";

// Validate pooled connections after they have been idle. Without this, the
// first request after an upstream/network idle timeout can borrow a dead Bolt
// connection and wait for the failed query to retry before doing useful work.
export const NEO4J_CONNECTION_LIVENESS_CHECK_TIMEOUT_MS = 30_000;

export const neo4jDriverConfig: Config = {
  connectionLivenessCheckTimeout:
    NEO4J_CONNECTION_LIVENESS_CHECK_TIMEOUT_MS,
};
