import { isObjectType, type GraphQLSchema } from "graphql";
import type { Neo4jGraphQL } from "@neo4j/graphql";
type InitializableModel = {
  name: string;
  selectionSet: string;
};

type Neo4jField = { fieldName: string };
type Neo4jNode = {
  name: string;
  primitiveFields: Neo4jField[];
  scalarFields: Neo4jField[];
  enumFields: Neo4jField[];
  temporalFields: Neo4jField[];
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

    // Neo4j OGM builds its default scalar selection from node metadata. That
    // metadata still contains fields hidden with @selectable, while the shared
    // executable schema correctly omits them. Keep the reused-schema model
    // selection aligned so default find/create/update calls cannot request a
    // private field that does not exist on the public output type.
    const node = (neoSchema as unknown as { nodes?: Neo4jNode[] }).nodes?.find(
      (candidate) => candidate.name === model.name
    );
    const outputType = schema.getType?.(model.name);
    if (!node || !isObjectType(outputType)) continue;

    const outputFields = outputType.getFields();
    const selectableFieldNames = [
      ...node.primitiveFields,
      ...node.scalarFields,
      ...node.enumFields,
      ...node.temporalFields,
    ]
      .map((field) => field.fieldName)
      .filter((fieldName) => outputFields[fieldName]);

    model.selectionSet = `{ ${selectableFieldNames.join(" ")} }`;
  }
}
