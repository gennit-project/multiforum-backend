export type SchemaConstraintManager = {
  assertIndexesAndConstraints(options: {
    options: { create: true };
  }): Promise<void>;
};

export async function ensureSchemaConstraints(
  schema: SchemaConstraintManager
): Promise<void> {
  await schema.assertIndexesAndConstraints({ options: { create: true } });
}
