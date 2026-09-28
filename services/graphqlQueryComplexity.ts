import type { ApolloServerPlugin } from "@apollo/server";
import {
  GraphQLError,
  isListType,
  isNonNullType,
  type DocumentNode,
  type GraphQLSchema,
} from "graphql";
import {
  getComplexity,
  simpleEstimator,
  type ComplexityEstimator,
} from "graphql-query-complexity";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "./pagination.js";

export const DEFAULT_MAX_QUERY_COMPLEXITY = 50_000;

export const resolveMaxQueryComplexity = (
  configuredValue = process.env.GRAPHQL_MAX_COMPLEXITY
): number => {
  const parsed = Number(configuredValue);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_QUERY_COMPLEXITY;
};

const listMultiplier = (args: Record<string, unknown>): number => {
  const options =
    args.options && typeof args.options === "object"
      ? (args.options as Record<string, unknown>)
      : undefined;
  const requested = args.first ?? args.limit ?? options?.limit;
  if (typeof requested !== "number" || !Number.isFinite(requested)) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.max(Math.trunc(requested), 0), MAX_PAGE_SIZE);
};

export const paginatedListEstimator: ComplexityEstimator = ({
  args,
  childComplexity,
  field,
}) => {
  const nullableType = isNonNullType(field.type) ? field.type.ofType : field.type;
  if (!isListType(nullableType)) return;

  // Charge for every row and its selected children. The base cost keeps an
  // empty page non-zero while @limit and the pagination guard provide the same
  // default/max values used by this estimate.
  return 1 + listMultiplier(args) * Math.max(childComplexity, 1);
};

export const complexityEstimators: ComplexityEstimator[] = [
  paginatedListEstimator,
  simpleEstimator({ defaultComplexity: 1 }),
];

export const calculateQueryComplexity = ({
  document,
  operationName,
  schema,
  variables,
}: {
  document: DocumentNode;
  operationName?: string;
  schema: GraphQLSchema;
  variables?: Record<string, unknown>;
}): number =>
  getComplexity({
    estimators: complexityEstimators,
    operationName,
    query: document,
    schema,
    variables,
  });

export const queryComplexityPlugin = ({
  maximumComplexity = DEFAULT_MAX_QUERY_COMPLEXITY,
}: {
  maximumComplexity?: number;
} = {}): ApolloServerPlugin => ({
  async requestDidStart() {
    return {
      async didResolveOperation({ document, request, schema }) {
        const actualComplexity = calculateQueryComplexity({
          document,
          operationName: request.operationName ?? undefined,
          schema,
          variables: request.variables,
        });

        if (actualComplexity > maximumComplexity) {
          throw new GraphQLError(
            `The query exceeds the maximum complexity of ${maximumComplexity}. Actual complexity is ${actualComplexity}.`,
            {
              extensions: {
                code: "GRAPHQL_VALIDATION_FAILED",
                actualComplexity,
                maximumComplexity,
              },
            }
          );
        }
      },
    };
  },
});
