import { Neo4jGraphQL } from "@neo4j/graphql";
import typeDefs from "../typeDefs.js";
import { createSchemaFeatures } from "../services/schemaFeatures.js";
import { createSubscriptionEngine } from "../services/subscriptionEngine.js";

/** Build the augmented public API without importing server startup or a driver. */
export async function buildPublicSchema() {
  const subscriptions = createSubscriptionEngine();
  try {
    return await new Neo4jGraphQL({
      typeDefs,
      features: createSchemaFeatures(subscriptions),
    }).getSchema();
  } finally {
    subscriptions.close();
  }
}
