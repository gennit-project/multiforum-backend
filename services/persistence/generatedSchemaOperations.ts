import {withDelegatedSourceMetadata} from "../delegatedSourceMetadata.js";
import { graphql, type GraphQLSchema } from "graphql";
import type { Driver, ManagedTransaction, Transaction } from "neo4j-driver";

import { withInternalAuthorSources } from "./internalAuthorSources.js";

type RegisteredSchema = {
  schema: GraphQLSchema;
  internalSchema: GraphQLSchema;
  database: string | undefined;
};
const registeredSchemas = new WeakMap<Driver, RegisteredSchema>();

/** Register the unwrapped executable schema, before middleware is applied. */
export function registerGeneratedSchema(
  driver: Driver,
  schema: GraphQLSchema,
  database?: string
): void {
  registeredSchemas.set(driver, { schema, internalSchema: withInternalAuthorSources(schema), database });
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
  jwt?: Record<string, unknown>,
  sourceRoot?: "collections"
): Promise<T> {
  const registered = registeredSchemas.get(driver);
  if (!registered) {
    throw new Error("Generated schema operations are not initialized for this driver");
  }
  const contextValue={
    sessionConfig:{database:registered.database},
    ...(executionContext ? {executionContext}:{}),
    ...(jwt ? {jwt}:{}),
  };
  const execute=async()=>{
    const result=await graphql({schema:registered.internalSchema,source,rootValue:null,variableValues,contextValue});
    if(result.errors?.length)throw new Error(result.errors[0].message);
    return result.data as T;
  };
  // Only explicitly owned fixed collection reads transfer provenance across
  // completion. Ordinary internal calls keep their existing query/context view.
  return sourceRoot ? withDelegatedSourceMetadata(contextValue,sourceRoot,execute,sourceRoot) : execute();
}

/** Public mutation adapters reuse the same unwrapped read schema. */
export function getGeneratedSchema(driver: Driver): GraphQLSchema {
  const registered = registeredSchemas.get(driver);
  if (!registered) throw new Error("Generated schema operations are not initialized for this driver");
  return registered.schema;
}

/** Query view for explicitly scoped delegated source metadata; no Shield or
 * request identity is introduced. Child resolvers remain shared with raw schema.
 */
export function getSourceAwareGeneratedSchema(driver: Driver): GraphQLSchema {
  const registered = registeredSchemas.get(driver);
  if (!registered) throw new Error("Generated schema operations are not initialized for this driver");
  return registered.internalSchema;
}
