import { getNamedType, isObjectType, Kind, parse, type GraphQLObjectType, type SelectionSetNode } from "graphql";
import type { Driver, ManagedTransaction, Transaction } from "neo4j-driver";
import { rememberCanonicalSource } from "../canonicalSourceFields.js";
import { executeGeneratedOperation, getGeneratedSchema } from "./generatedSchemaOperations.js";

type ObjectPlan = ReadonlyMap<string, ObjectPlan>;

/** Opt-in only for fixed, unconditional, alias-free object documents. Build the
 * provenance plan from the actual executed document and schema before any write.
 * GraphQL still owns coercion/completion. Scalar values (including JSON), abstract
 * types and caller-selected documents are not certified by this adapter.
 */
export async function executeCanonicalFixedOperation<T>(
  driver: Driver,
  source: string,
  variables: Record<string, unknown>,
  transaction?: ManagedTransaction | Transaction,
  jwt?: Record<string, unknown>,
): Promise<T> {
  const schema = getGeneratedSchema(driver);
  const document = parse(source);
  if (document.definitions.length !== 1 || document.definitions[0].kind !== Kind.OPERATION_DEFINITION) {
    throw new Error("Canonical fixed operation requires exactly one operation and no fragments");
  }
  const operation = document.definitions[0];
  const root = operation.operation === "query" ? schema.getQueryType() : operation.operation === "mutation" ? schema.getMutationType() : undefined;
  if (!root || operation.directives?.length) throw new Error("Unsupported canonical fixed operation");
  function merge(left: ObjectPlan | undefined, right: ObjectPlan): ObjectPlan {
    const combined = new Map(left);
    for (const [key, child] of right) combined.set(key, merge(combined.get(key), child));
    return combined;
  }
  function plan(set: SelectionSetNode, type: GraphQLObjectType): ObjectPlan {
    const children = new Map<string, ObjectPlan>();
    for (const node of set.selections) {
      if (node.kind !== Kind.FIELD || node.alias || node.directives?.length) throw new Error("Canonical fixed selections cannot contain aliases, fragments or directives");
      const field = type.getFields()[node.name.value];
      if (!field) throw new Error(`Unknown fixed field ${type.name}.${node.name.value}`);
      if (node.selectionSet) {
        const childType = getNamedType(field.type);
        if (!isObjectType(childType)) throw new Error("Canonical fixed selections require concrete object children");
        children.set(node.name.value, merge(children.get(node.name.value), plan(node.selectionSet, childType)));
      }
    }
    return children;
  }
  const selection = plan(operation.selectionSet, root);
  const result = await executeGeneratedOperation<T>(driver, source, variables, transaction, jwt);
  function remember(value: unknown, children: ObjectPlan): void {
    if (Array.isArray(value)) {
      const items: readonly unknown[] = value;
      for (const item of items) remember(item, children);
    } else if (value !== null && typeof value === "object") {
      rememberCanonicalSource(value);
      for (const [key, child] of children) if (Object.prototype.hasOwnProperty.call(value, key)) remember(Reflect.get(value, key), child);
    }
  }
  remember(result, selection);
  return result;
}
