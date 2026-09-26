import { GraphQLError, type GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../types/context.js";

/**
 * Temporary interlock for the age-gate upgrade
 * (docs/age-gate-materialization-design.md, "Order of work").
 *
 * The age-gate filters now read stored `ageGateRestricted` flags, but the
 * write paths that keep those flags current for new and moved content ship
 * in later steps. Until then, marking content sensitive or turning the gate on
 * could leave content under marked content unflagged, and therefore visible
 * to restricted viewers. This rejects both, wherever they appear in a
 * mutation's input, including nested relationship inputs.
 *
 * Remove once write-time marking and transaction-owned re-evaluation ship
 * (design step 5).
 */
const BLOCKED_FIELDS = new Set(["hasSensitiveContent", "sensitiveContentAgeGateEnabled"]);

export const AGE_GATE_UPGRADE_ERROR_CODE = "AGE_GATE_UPGRADE_IN_PROGRESS";

/** Paths in `args` that set a blocked field to true. */
export const findBlockedAgeGateWrites = (value: unknown, path = "args"): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      findBlockedAgeGateWrites(item, `${path}[${index}]`)
    );
  }
  if (!value || typeof value !== "object") return [];

  return Object.entries(value).flatMap(([key, child]) => {
    const childPath = `${path}.${key}`;
    if (BLOCKED_FIELDS.has(key) && child === true) return [childPath];
    return findBlockedAgeGateWrites(child, childPath);
  });
};

type Resolver = (
  parent: unknown,
  args: Record<string, unknown>,
  context: GraphQLContext,
  info: GraphQLResolveInfo
) => Promise<unknown>;

export const rejectAgeGateWritesDuringUpgrade = async (
  resolve: Resolver,
  parent: unknown,
  args: Record<string, unknown>,
  context: GraphQLContext,
  info: GraphQLResolveInfo
) => {
  const blocked = findBlockedAgeGateWrites(args);
  if (blocked.length > 0) {
    throw new GraphQLError(
      "Marking content as sensitive and enabling the sensitive-content age gate are temporarily unavailable while the age gate is being upgraded.",
      { extensions: { code: AGE_GATE_UPGRADE_ERROR_CODE, paths: blocked } }
    );
  }
  return resolve(parent, args, context, info);
};

const ageGateInterlockMiddleware = {
  Mutation: rejectAgeGateWritesDuringUpgrade,
};

export default ageGateInterlockMiddleware;
