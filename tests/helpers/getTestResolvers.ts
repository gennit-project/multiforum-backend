import type { Driver } from "neo4j-driver";
import getCustomResolvers from "../../customResolvers.js";

// Test-only passthrough mirroring getCustomResolvers(driver) -> { resolvers }.
// The OGM the pre-removal composition root threaded through here is gone; tests
// build their executable schema from Neo4jGraphQL directly and drive the driver
// repositories, so no OGM instance is created.
export default function getTestResolvers(driver: Driver) {
  return getCustomResolvers(driver);
}
