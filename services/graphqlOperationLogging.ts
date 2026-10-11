import { createHash } from "node:crypto";
import type { ApolloServerPlugin } from "@apollo/server";
import { logger } from "../logger.js";

const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);

export const resolveDiagnosticQueryLogging = (
  value = process.env.GRAPHQL_DIAGNOSTIC_QUERY_LOGGING
): boolean => ENABLED_VALUES.has(value?.trim().toLowerCase() ?? "");

export const fingerprintGraphQLQuery = (query: string): string =>
  createHash("sha256").update(query).digest("hex");

export interface GraphQLOperationObservation {
  operationName: string;
  operationType?: "query" | "mutation" | "subscription";
  queryFingerprint: string;
  outcome: "success" | "error";
  httpStatus?: number;
  query?: string;
}

const responseHasErrors = (body: unknown): boolean => {
  if (!body || typeof body !== "object" || !("kind" in body)) return false;
  if (body.kind !== "single" || !("singleResult" in body)) return false;
  const result = body.singleResult;
  return Boolean(
    result &&
    typeof result === "object" &&
    "errors" in result &&
    Array.isArray(result.errors) &&
    result.errors.length > 0
  );
};

export const graphqlOperationLoggingPlugin = ({
  includeQueryText = resolveDiagnosticQueryLogging(),
  report = (observation: GraphQLOperationObservation) =>
    logger.info("GraphQL operation", observation),
}: {
  includeQueryText?: boolean;
  report?: (observation: GraphQLOperationObservation) => void;
} = {}): ApolloServerPlugin => ({
  async requestDidStart({ request }) {
    const query = request.query ?? "";
    const isIntrospection = query.includes("IntrospectionQuery");
    let operationType: GraphQLOperationObservation["operationType"];
    let encounteredErrors = false;

    return {
      async didResolveOperation({ operation }) {
        operationType = operation?.operation;
      },
      async didEncounterErrors() {
        encounteredErrors = true;
      },
      async willSendResponse({ request: completedRequest, response }) {
        if (isIntrospection) return;
        report({
          operationName: completedRequest.operationName ?? "Anonymous",
          operationType,
          queryFingerprint: fingerprintGraphQLQuery(query),
          outcome: encounteredErrors || responseHasErrors(response.body)
            ? "error"
            : "success",
          httpStatus: response.http.status,
          ...(includeQueryText ? { query } : {}),
        });
      },
    };
  },
});
