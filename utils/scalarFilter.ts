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
