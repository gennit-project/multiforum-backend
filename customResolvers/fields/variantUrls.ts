import type { GraphQLResolveInfo } from "graphql";

type VariantParent = Record<string, unknown> & {
  variantUrls?: unknown;
};

const asNonEmptyString = (value: unknown): string | null => {
  return typeof value === "string" && value.trim() ? value : null;
};

export const createVariantUrlsResolver = (fields: Record<string, string>) => {
  return (parent: VariantParent, _args?: unknown, _context?: unknown, info?: GraphQLResolveInfo) => {
    const directVariants = Object.entries(fields).reduce<Record<string, string>>(
      (accumulator, [variantKey, fieldName]) => {
        const value = asNonEmptyString(parent[fieldName]);
        if (value) {
          accumulator[variantKey] = value;
        }
        return accumulator;
      },
      {}
    );

    // Neo4j properties cannot contain maps. New writes store JSON text; old
    // projections may still supply a map or only the explicit scalar fields.
    const responseKey = info?.path.key;
    let stored: unknown = typeof responseKey === "string" && Object.prototype.hasOwnProperty.call(parent, responseKey)
      ? parent[responseKey]
      : parent.variantUrls;
    if (typeof stored === "string") {
      try {
        stored = JSON.parse(stored);
      } catch {
        stored = null;
      }
    }
    const storedVariants =
      stored && typeof stored === "object" && !Array.isArray(stored)
        ? Object.entries(stored).reduce<Record<string, string>>(
            (accumulator, [variantKey, value]) => {
              const normalized = asNonEmptyString(value);
              if (normalized) {
                accumulator[variantKey] = normalized;
              }
              return accumulator;
            },
            {}
          )
        : {};

    const merged = {
      ...storedVariants,
      ...directVariants,
    };

    return Object.keys(merged).length ? merged : null;
  };
};
