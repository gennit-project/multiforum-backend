// Builds the real application GraphQL schema with the real graphql-shield
// permission layer applied — the same two steps index.ts performs:
//
//   schema = await neoSchema.getSchema()
//   schema = applyMiddleware(schema, permissions, ...)
//
// Only the `permissions` middleware is applied here, to isolate the
// authorization wiring under test from the unrelated history/mention/plugin
// middleware. This lets tests execute real operations and assert that each one
// is gated by the rule it's supposed to be gated by.
//
// graphql-shield rejects unauthorized operations BEFORE any resolver runs, so
// deny-path tests never touch Neo4j — the driver here is never actually used.

import { Neo4jGraphQL } from "@neo4j/graphql";
import { applyMiddleware } from "graphql-middleware";
import neo4j, { Driver } from "neo4j-driver";
import type { GraphQLSchema } from "graphql";
import typeDefs from "../../typeDefs.js";
import permissions from "../../permissions.js";
import getCustomResolvers from "../../customResolvers.js";

export interface PermissionedSchema {
  schema: GraphQLSchema;
  driver: Driver;
  ogm: any;
}

export async function buildPermissionedSchema(): Promise<PermissionedSchema> {
  // Pointed at a local address but never connected to: deny-path tests resolve
  // entirely within graphql-shield.
  const driver = neo4j.driver(
    process.env.NEO4J_URI || "bolt://localhost:7687",
    neo4j.auth.basic(
      process.env.NEO4J_USER || "neo4j",
      process.env.NEO4J_PASSWORD || "test-password"
    )
  );

  const { ogm, resolvers } = getCustomResolvers(driver);
  const neoSchema = new Neo4jGraphQL({ typeDefs, driver, resolvers });

  let schema = await neoSchema.getSchema();
  schema = applyMiddleware(schema, permissions);

  return { schema, driver, ogm };
}

// A context shaped like the one index.ts builds, for an unauthenticated request
// (no Authorization header). `isMutation` mirrors what the Apollo context sets.
export function makeRequestContext(options: {
  authorization?: string;
  isMutation?: boolean;
  driver: Driver;
  ogm: any;
}) {
  return {
    driver: options.driver,
    ogm: options.ogm,
    req: {
      headers: options.authorization
        ? { authorization: options.authorization }
        : {},
      body: {},
      isMutation: options.isMutation ?? false,
    },
  };
}
