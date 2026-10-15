import {
  Neo4jGraphQLSubscriptionsCDCEngine,
} from "@neo4j/graphql";
import type { Driver } from "neo4j-driver";

const CDC_CURRENT_QUERY = "CALL cdc.current() YIELD id RETURN id";
const CDC_PERMISSION_QUERY =
  "CALL cdc.query($cursor) YIELD id RETURN id LIMIT 1";

export class Neo4jCdcConfigurationError extends Error {
  readonly cause: unknown;

  constructor(database: string, cause: unknown) {
    const detail = cause instanceof Error ? ` ${cause.message}` : "";
    super(
      `Neo4j Change Data Capture is unavailable for database \"${database}\".` +
        " Enable CDC in FULL mode and grant the application user permission" +
        ` to execute cdc.query before starting the server.${detail}`
    );
    this.name = "Neo4jCdcConfigurationError";
    this.cause = cause;
  }
}

/**
 * Verify both CDC configuration and the application's ability to consume the
 * stream. cdc.current confirms that enrichment is enabled; cdc.query also
 * catches a missing boosted procedure grant before background services start.
 */
export async function assertNeo4jCdcAvailable(
  driver: Driver,
  database: string
): Promise<void> {
  try {
    const current = await driver.executeQuery(
      CDC_CURRENT_QUERY,
      {},
      { database }
    );
    const cursor = current.records[0]?.get("id");

    if (typeof cursor !== "string" || cursor.length === 0) {
      throw new Error("cdc.current did not return a change identifier");
    }

    await driver.executeQuery(CDC_PERMISSION_QUERY, { cursor }, { database });
  } catch (error) {
    throw new Neo4jCdcConfigurationError(database, error);
  }
}

export function createNeo4jCdcSubscriptionsEngine(
  driver: Driver,
  database: string
): Neo4jGraphQLSubscriptionsCDCEngine {
  return new Neo4jGraphQLSubscriptionsCDCEngine({
    driver,
    queryConfig: { database },
  });
}
