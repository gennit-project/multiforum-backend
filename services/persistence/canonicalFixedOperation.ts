import type { Driver, ManagedTransaction, Transaction } from "neo4j-driver";
import { prepareCanonicalDocumentSource } from "../canonicalDocumentSources.js";
import { executeGeneratedOperation, getGeneratedSchema } from "./generatedSchemaOperations.js";

/** Fixed projection contracts additionally reject document drift before writes.
 * Ordinary generated execution derives the same provenance after completion,
 * but leaves unsupported caller-selected documents unchanged.
 */
export async function executeCanonicalFixedOperation<T>(
  driver: Driver,
  source: string,
  variables: Record<string, unknown>,
  transaction?: ManagedTransaction | Transaction,
  jwt?: Record<string, unknown>,
): Promise<T> {
  prepareCanonicalDocumentSource(getGeneratedSchema(driver), source);
  return executeGeneratedOperation<T>(driver, source, variables, transaction, jwt);
}
