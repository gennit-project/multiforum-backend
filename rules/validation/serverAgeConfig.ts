import { rule } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";
import { validateMinimumAge } from "../../services/agePolicy.js";

const AGE_FIELDS = ["minimumAccountAge", "minimumSensitiveContentAge"] as const;

export function validateServerAgeConfigInput(input: unknown): true | string {
  if (!input || typeof input !== "object") return true;

  const config = input as Record<string, unknown>;
  for (const field of AGE_FIELDS) {
    if (field in config && !validateMinimumAge(config[field])) {
      return `${field} must be a whole number between 1 and 120.`;
    }
  }
  return true;
}

export const serverAgeConfigIsValid = rule({ cache: "contextual" })(
  async (
    _parent: unknown,
    args: Record<string, unknown>,
    _context: GraphQLContext,
    _info: GraphQLResolveInfo
  ) => {
    const inputs: unknown[] = [];
    if (Array.isArray(args.input)) inputs.push(...args.input);
    if (args.update) inputs.push(args.update);

    for (const input of inputs) {
      const result = validateServerAgeConfigInput(input);
      if (result !== true) return result;
    }
    return true;
  }
);
