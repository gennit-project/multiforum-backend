import type { IdScalarFilters } from "../src/generated/graphql.js";
// v7 (@neo4j/graphql 7) nests scalar `where` filters as `{ eq: "..." }`
// (IDScalarFilters / StringScalarFilters), where v5 accepted a flat scalar.
// Hand-written middleware that pulls a single id / uniqueName out of
// `args.where` must therefore read the `.eq` value. Passing the whole filter
// object straight into a repository lookup re-wraps it into
// `{ field: { eq: { eq: ... } } }`, which fails variable coercion with
// "ID cannot represent value / String cannot represent value".
export type ScalarFilter = string | { eq?: string | null } | null | undefined;

export const stringFromScalarFilter = (
  value: ScalarFilter
): string | undefined => {
  if (typeof value === "string") return value || undefined;
  if (value && typeof value === "object" && typeof value.eq === "string") {
    return value.eq || undefined;
  }
  return undefined;
};

/** Candidate IDs for permission preflight. Equality is the narrowest candidate
 * when combined with other scalar predicates; arbitrary text filters do not
 * establish a bounded set of authorized targets. */
export type IdFilter = string | IdScalarFilters | null | undefined;
export const idsFromScalarFilter = (value: IdFilter): string[] => {
  const single = stringFromScalarFilter(value);
  if (single) return [single];
  return value && typeof value === "object" ? value.in ?? [] : [];
};
