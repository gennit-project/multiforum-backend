// v7 dropped the `{ options: { create: true } }` argument from
// assertIndexesAndConstraints — but, unlike the note that used to live here, v7
// does NOT create anything: it only CHECKS that the schema's indexes/constraints
// already exist and throws if any are missing. The @fulltext indexes are created
// up front by ensureFulltextIndexes (services/fulltextIndexes.ts) before this
// runs, so on a fresh database the check passes. The driver is already bound on
// the Neo4jGraphQL instance, so we call it with no arguments.
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
