import { graphql, type GraphQLSchema } from "graphql";
import type { Driver, ManagedTransaction, Transaction } from "neo4j-driver";

type RegisteredSchema = {
  schema: GraphQLSchema;
  database: string | undefined;
};
const registeredSchemas = new WeakMap<Driver, RegisteredSchema>();

/** Register the unwrapped executable schema, before middleware is applied. */
export function registerGeneratedSchema(
  driver: Driver,
  schema: GraphQLSchema,
  database?: string
): void {
  registeredSchemas.set(driver, { schema, database });
}

/**
 * Execute a domain-owned GraphQL document through the supported GraphQL API.
 * This is not a model/CRUD API: callers own fixed selections and variable types.
 * These internal reads carry no request authentication context by default, so
 * the schema's `@authorization` filters evaluate against an empty `jwt`. A
 * caller that has ALREADY made an access decision (e.g. age-gate eligibility)
 * may pass a minimal `jwt` so those filters agree with that decision rather
 * than silently excluding rows the caller intends to return.
 * An explicit transaction is forwarded only when its caller owns that boundary.
 *
 * The current OGM is constructed without a database option, so its internal
 * calls supply {sessionConfig: {database: undefined}}. The configured driver
 * wrapper selects the application database. Registration retains an explicit
 * database option for callers that intentionally configure another database.
 */
export async function executeGeneratedOperation<T>(
  driver: Driver,
  source: string,
  variableValues: Record<string, unknown>,
  executionContext?: ManagedTransaction | Transaction,
  jwt?: Record<string, unknown>
): Promise<T> {
  const registered = registeredSchemas.get(driver);
  if (!registered) {
    throw new Error("Generated schema operations are not initialized for this driver");
  }
  const result = await graphql({
    schema: registered.schema,
    source,
    rootValue: null,
    variableValues,
    contextValue: {
      sessionConfig: { database: registered.database },
      ...(executionContext ? { executionContext } : {}),
      ...(jwt ? { jwt } : {}),
    },
  });
  if (result.errors?.length) throw new Error(result.errors[0].message);
  return result.data as T;
}
