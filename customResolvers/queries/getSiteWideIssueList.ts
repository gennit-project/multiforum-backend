import type { GraphQLResolveInfo } from "graphql";
import neo4j, { type Driver, type Record as Neo4jRecord } from "neo4j-driver";
import { DateTime } from "luxon";
import { getSiteWideIssuesQuery } from "../cypher/cypherQueries.js";
import type { GraphQLContext } from "../../types/context.js";
import { logger } from "../../logger.js";

type Input = {
  driver: Driver;
};

type Args = {
  searchInput?: string;
  selectedChannels?: string[];
  startDate?: string | null;
  endDate?: string | null;
  showOnlyServerRuleViolations?: boolean;
  isOpen: boolean;
  options?: {
    offset?: number | null;
    limit?: number | null;
    sort?: string | null;
  };
};

const VALID_SORTS = new Set(["newest", "oldest", "mostReports"]);
const DEFAULT_LIMIT = 1_000_000_000;

const sanitize = (value: unknown): unknown => {
  if (neo4j.isInt(value)) return value.toNumber();
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitize(entry)])
    );
  }
  return value;
};

const normalizeDateStart = (value: string | null | undefined) => {
  if (!value) return null;
  const parsed = DateTime.fromISO(value, { zone: "utc" });
  return parsed.isValid ? parsed.startOf("day").toISO() : null;
};

const normalizeDateEnd = (value: string | null | undefined) => {
  if (!value) return null;
  const parsed = DateTime.fromISO(value, { zone: "utc" });
  return parsed.isValid ? parsed.endOf("day").toISO() : null;
};

const normalizePaginationValue = (
  value: number | null | undefined,
  fallback: number
) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return neo4j.int(fallback);
  }
  return neo4j.int(Math.max(0, Math.trunc(value)));
};

const getResolver = (input: Input) => {
  const { driver } = input;

  return async (
    parent: unknown,
    args: Args,
    context: GraphQLContext,
    info: GraphQLResolveInfo
  ) => {
    const searchInput = args.searchInput ?? "";
    const selectedChannels = args.selectedChannels ?? [];
    const showOnlyServerRuleViolations =
      args.showOnlyServerRuleViolations ?? true;
    const offset = normalizePaginationValue(args.options?.offset, 0);
    const limit = normalizePaginationValue(args.options?.limit, DEFAULT_LIMIT);
    const sort = VALID_SORTS.has(args.options?.sort || "")
      ? args.options?.sort || "newest"
      : "newest";

    const session = driver.session();
    const titleRegex = `(?i).*${searchInput}.*`;
    const bodyRegex = `(?i).*${searchInput}.*`;
    const startDate = normalizeDateStart(args.startDate);
    const endDate = normalizeDateEnd(args.endDate);

    try {
      const issueResult = await session.run(getSiteWideIssuesQuery, {
        searchInput,
        titleRegex,
        bodyRegex,
        selectedChannels,
        showOnlyServerRuleViolations,
        startDate,
        endDate,
        isOpen: args.isOpen,
        offset,
        limit,
        sort,
      });

      const firstRecord = issueResult.records[0];
      const aggregateIssueCount = firstRecord
        ? sanitize(firstRecord.get("totalCount"))
        : 0;
      const issues = issueResult.records.map((record: Neo4jRecord) =>
        sanitize(record.get("issue"))
      );

      return {
        aggregateIssueCount,
        issues,
      };
    } catch (error: unknown) {
      logger.error("Error getting site wide issues:", error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to fetch site wide issues. ${message}`);
    } finally {
      session.close();
    }
  };
};

export default getResolver;
