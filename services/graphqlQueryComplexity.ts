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
import { MAX_PAGE_SIZE } from "./pagination.js";

export const DEFAULT_MAX_QUERY_COMPLEXITY = 50_000;
export const DEFAULT_UNSPECIFIED_LIST_SIZE = 5;

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
    // Complexity is an estimate of typical work, not a multiplication of every
    // theoretical maximum. Most nested relationship and custom-projection
    // lists in the application contain only a handful of rows. Charging the
    // full 25-row server default at every nesting level made valid frontend
    // operations score in the millions even on the small production graph.
    return DEFAULT_UNSPECIFIED_LIST_SIZE;
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

export interface QueryComplexityObservation {
  operationName: string;
  actualComplexity: number;
  maximumComplexity: number;
  rejected: boolean;
}

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
  report,
}: {
  maximumComplexity?: number;
  report?: (observation: QueryComplexityObservation) => void;
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
        const rejected = actualComplexity > maximumComplexity;

        report?.({
          operationName: request.operationName ?? "Anonymous",
          actualComplexity,
          maximumComplexity,
          rejected,
        });

        if (rejected) {
          throw new GraphQLError(
            `The query exceeds the maximum complexity of ${maximumComplexity}. Actual complexity is ${actualComplexity}.`,
            {
              extensions: {
                code: "QUERY_TOO_COMPLEX",
                actualComplexity,
                maximumComplexity,
                http: { status: 400 },
              },
            }
          );
        }
      },
    };
  },
});
