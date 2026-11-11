import { getNamedType, isObjectType, Kind, parse, type GraphQLSchema, type GraphQLObjectType, type SelectionSetNode } from "graphql";
import { rememberCanonicalSource } from "./canonicalSourceFields.js";

type ObjectPlan = ReadonlyMap<string, ObjectPlan>;
export class UnsupportedCanonicalDocument extends Error {}

/** Prove canonical keys from the actual document, not a claimed result type.
 * This narrow plan deliberately excludes aliases, fragments, conditional and
 * abstract selections. Leaves, including JSON objects, are never traversed.
 */
export function prepareCanonicalDocumentSource(schema: GraphQLSchema, source: string): (result: unknown) => void {
  const document = parse(source);
  if (document.definitions.length !== 1 || document.definitions[0].kind !== Kind.OPERATION_DEFINITION) {
    throw new UnsupportedCanonicalDocument("Canonical fixed operation requires exactly one operation and no fragments");
  }
  const operation = document.definitions[0];
  const root = operation.operation === "query" ? schema.getQueryType() : operation.operation === "mutation" ? schema.getMutationType() : undefined;
  if (!root || operation.directives?.length) throw new UnsupportedCanonicalDocument("Unsupported canonical fixed operation");
  function merge(left: ObjectPlan | undefined, right: ObjectPlan): ObjectPlan {
    const combined = new Map(left);
    for (const [key, child] of right) combined.set(key, merge(combined.get(key), child));
    return combined;
  }
  function plan(set: SelectionSetNode, type: GraphQLObjectType): ObjectPlan {
    const children = new Map<string, ObjectPlan>();
    for (const node of set.selections) {
      if (node.kind !== Kind.FIELD || node.alias || node.directives?.length) throw new UnsupportedCanonicalDocument("Canonical fixed selections cannot contain aliases, fragments or directives");
      const field = type.getFields()[node.name.value];
      if (!field) throw new UnsupportedCanonicalDocument(`Unknown fixed field ${type.name}.${node.name.value}`);
      if (node.selectionSet) {
        const childType = getNamedType(field.type);
        if (!isObjectType(childType)) throw new UnsupportedCanonicalDocument("Canonical fixed selections require concrete object children");
        children.set(node.name.value, merge(children.get(node.name.value), plan(node.selectionSet, childType)));
      }
    }
    return children;
  }
  const selection = plan(operation.selectionSet, root);
  function remember(value: unknown, children: ObjectPlan): void {
    if (Array.isArray(value)) {
      const items: readonly unknown[] = value;
      for (const item of items) remember(item, children);
    } else if (value !== null && typeof value === "object") {
      rememberCanonicalSource(value);
      for (const [key, child] of children) if (Object.prototype.hasOwnProperty.call(value, key)) remember(Reflect.get(value, key), child);
    }
  }
  return result => remember(result, selection);
}

/** A completed internal response may acquire key provenance only when the
 * concrete document proves it. Unsupported documents remain entirely untouched.
 * This is not a scalar validator, author identity, or whole-object type assertion.
 */
export function rememberCanonicalCompletedDocument(schema: GraphQLSchema, source: string, result: unknown): void {
  let remember: (value: unknown) => void;
  try { remember = prepareCanonicalDocumentSource(schema, source); }
  catch (error) { if (error instanceof UnsupportedCanonicalDocument) return; throw error; }
  remember(result);
}
