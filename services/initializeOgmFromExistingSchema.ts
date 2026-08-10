import type { GraphQLSchema } from "graphql";
import type { Neo4jGraphQL } from "@neo4j/graphql";
type InitializableModel = {
  name: string;
};

type InitializableOgm = {
  _schema?: GraphQLSchema;
  neoSchema?: Neo4jGraphQL;
  models: InitializableModel[];
  initModel(model: InitializableModel): void;
};

/**
 * The runtime only needs one executable GraphQL schema, but @neo4j/graphql-ogm
 * rebuilds its own copy when `ogm.init()` runs. On memory-constrained dynos
 * that second schema build can push startup over the V8 heap limit. Reuse the
 * already-built application schema and hydrate each model against it instead.
 */
export function initializeOgmFromExistingSchema(
  ogm: unknown,
  neoSchema: Neo4jGraphQL,
  schema: GraphQLSchema
): void {
  const initializableOgm = ogm as InitializableOgm;
  initializableOgm.neoSchema = neoSchema;
  initializableOgm._schema = schema;

  for (const model of initializableOgm.models) {
    initializableOgm.initModel(model);
  }
}
