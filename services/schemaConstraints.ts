// v7 dropped the `{ options: { create: true } }` argument from
// assertIndexesAndConstraints — it now creates missing indexes/constraints by
// default and takes only an optional { driver, sessionConfig }. The driver is
// already bound on the Neo4jGraphQL instance, so we call it with no arguments.
export type SchemaConstraintManager = {
  assertIndexesAndConstraints(args?: {
    driver?: unknown;
    sessionConfig?: unknown;
  }): Promise<void>;
};

export async function ensureSchemaConstraints(
  schema: SchemaConstraintManager
): Promise<void> {
  await schema.assertIndexesAndConstraints();
}
