import type { ApolloServerPlugin } from "@apollo/server";
import {
  GraphQLError,
  Kind,
  type DocumentNode,
  type FragmentDefinitionNode,
  type OperationDefinitionNode,
  type ValueNode,
  visit,
} from "graphql";
import { MAX_PAGE_SIZE } from "./pagination.js";

const assertLimit = (value: unknown, path: string, maxLimit: number) => {
  if (typeof value !== "number") return;
  if (Number.isInteger(value) && value >= 0 && value <= maxLimit) return;
  throw new GraphQLError(
    `${path} must be a non-negative integer at most ${maxLimit}.`,
    {
      extensions: { code: "BAD_USER_INPUT", maxLimit },
    }
  );
};

const inspectVariables = (
  value: unknown,
  maxLimit: number,
  path = "variables"
): void => {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      inspectVariables(entry, maxLimit, `${path}[${index}]`)
    );
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    const entryPath = `${path}.${key}`;
    if (key === "limit") assertLimit(entry, entryPath, maxLimit);
    inspectVariables(entry, maxLimit, entryPath);
  }
};

const literalValue = (node: ValueNode): number | undefined => {
  if (node.kind !== Kind.INT) return undefined;
  return Number(node.value);
};

const selectedDocument = (
  document: DocumentNode,
  operation: OperationDefinitionNode
): DocumentNode => {
  const fragments = new Map(
    document.definitions
      .filter(
        (definition): definition is FragmentDefinitionNode =>
          definition.kind === Kind.FRAGMENT_DEFINITION
      )
      .map((definition) => [definition.name.value, definition])
  );
  const selectedFragments: FragmentDefinitionNode[] = [];
  const pending = new Set<string>();
  const collectSpreads = (node: OperationDefinitionNode | FragmentDefinitionNode) =>
    visit(node, {
      FragmentSpread(spread) {
        pending.add(spread.name.value);
      },
    });

  collectSpreads(operation);
  while (pending.size > 0) {
    const [name] = pending;
    pending.delete(name);
    const fragment = fragments.get(name);
    if (!fragment || selectedFragments.includes(fragment)) continue;
    selectedFragments.push(fragment);
    collectSpreads(fragment);
  }

  return {
    kind: Kind.DOCUMENT,
    definitions: [operation, ...selectedFragments],
  };
};

export function assertQueryPaginationLimits({
  document,
  operation,
  variables,
  maxLimit = MAX_PAGE_SIZE,
}: {
  document: DocumentNode;
  operation: OperationDefinitionNode;
  variables?: Record<string, unknown>;
  maxLimit?: number;
}): void {
  if (operation.operation !== "query") return;
  inspectVariables(variables, maxLimit);
  visit(selectedDocument(document, operation), {
    Argument(node) {
      if (node.name.value !== "limit") return;
      assertLimit(literalValue(node.value), "limit", maxLimit);
    },
    ObjectField(node) {
      if (node.name.value !== "limit") return;
      assertLimit(literalValue(node.value), "limit", maxLimit);
    },
  });
}

export const paginationLimitPlugin: ApolloServerPlugin = {
  async requestDidStart() {
    return {
      async didResolveOperation({ document, operation, request }) {
        if (!operation) return;
        assertQueryPaginationLimits({
          document,
          operation,
          variables: request.variables,
        });
      },
    };
  },
};
