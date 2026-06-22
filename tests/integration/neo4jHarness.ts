// Testcontainers-backed Neo4j harness for integration tests.
//
// Starts a throwaway Neo4j container, hands back a driver pointed at it, and
// tears everything down afterward. Used by integration tests that exercise the
// real .cypher queries against a live database (something unit tests, which
// mock the driver, can't cover).
//
// Requires a running Docker daemon. The unit-test scripts deliberately prune
// tests/integration so a missing Docker daemon never breaks `npm test`.

import { Neo4jContainer, StartedNeo4jContainer } from "@testcontainers/neo4j";
import neo4j, { Driver } from "neo4j-driver";

// Pin to the Neo4j 5.x line the app targets (neo4j-driver ^5.26, @neo4j/graphql
// ^5). Overridable for testing against a specific patch release.
const NEO4J_IMAGE = process.env.NEO4J_TEST_IMAGE || "neo4j:5-community";

let container: StartedNeo4jContainer | undefined;
let driver: Driver | undefined;

export async function startNeo4j(): Promise<Driver> {
  container = await new Neo4jContainer(NEO4J_IMAGE).start();
  driver = neo4j.driver(
    container.getBoltUri(),
    neo4j.auth.basic(container.getUsername(), container.getPassword())
  );
  // Fail fast with a clear error if the container isn't actually reachable.
  await driver.getServerInfo();
  return driver;
}

export async function stopNeo4j(): Promise<void> {
  await driver?.close();
  await container?.stop();
  driver = undefined;
  container = undefined;
}

// Wipes all nodes and relationships so each test starts from a clean graph.
export async function resetDatabase(activeDriver: Driver): Promise<void> {
  const session = activeDriver.session();
  try {
    await session.run("MATCH (n) DETACH DELETE n");
  } finally {
    await session.close();
  }
}
