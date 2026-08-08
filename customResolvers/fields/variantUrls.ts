type VariantParent = Record<string, unknown> & {
  variantUrls?: Record<string, string | null | undefined> | null;
};

const asNonEmptyString = (value: unknown): string | null => {
  return typeof value === "string" && value.trim() ? value : null;
};

export const createVariantUrlsResolver = (fields: Record<string, string>) => {
  return (parent: VariantParent) => {
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

    const storedVariants =
      parent.variantUrls && typeof parent.variantUrls === "object"
        ? Object.entries(parent.variantUrls).reduce<Record<string, string>>(
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
