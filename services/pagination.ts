import { GraphQLError } from "graphql";

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

const parseInteger = (
  value: number | string | null | undefined,
  fallback: number,
  name: "offset" | "limit"
): number => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new GraphQLError(`${name} must be a non-negative integer.`, {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  return parsed;
};

export function normalizePagination({
  offset,
  limit,
  defaultLimit = DEFAULT_PAGE_SIZE,
  maxLimit = MAX_PAGE_SIZE,
}: {
  offset?: number | string | null;
  limit?: number | string | null;
  defaultLimit?: number;
  maxLimit?: number;
}): { offset: number; limit: number } {
  const normalizedOffset = parseInteger(offset, 0, "offset");
  const normalizedLimit = parseInteger(limit, defaultLimit, "limit");
  if (normalizedLimit > maxLimit) {
    throw new GraphQLError(`limit must be at most ${maxLimit}.`, {
      extensions: { code: "BAD_USER_INPUT", maxLimit },
    });
  }
  return { offset: normalizedOffset, limit: normalizedLimit };
}
