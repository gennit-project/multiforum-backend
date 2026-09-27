import { GraphQLError, type GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../types/context.js";
import { logger } from "../logger.js";
import { findUnsafeAgeGateWrites } from "../services/ageGate/writeGuard.js";

/**
 * Age-gate write validator (docs/age-gate-materialization-design.md, step 4).
 *
 * Checks every mutation for writes the driver-level reconcile step can't see:
 * connecting an existing node along a relationship an age-gate definition
 * follows, and writing `hasSensitiveContent` outside the mutations that own it.
 * See services/ageGate/writeGuard.ts.
 *
 * Ships log-only, to inventory real traffic. Set
 * `AGE_GATE_WRITE_VALIDATOR=enforce` to reject these writes instead.
 */
export const AGE_GATE_UNSAFE_WRITE_ERROR_CODE = "AGE_GATE_UNSAFE_WRITE";

const isEnforcing = () => process.env.AGE_GATE_WRITE_VALIDATOR === "enforce";

type Resolver = (
  parent: unknown,
  args: Record<string, unknown>,
  context: GraphQLContext,
  info: GraphQLResolveInfo
) => Promise<unknown>;

export const validateAgeGateWrites = async (
  resolve: Resolver,
  parent: unknown,
  args: Record<string, unknown>,
  context: GraphQLContext,
  info: GraphQLResolveInfo
) => {
  const unsafe = findUnsafeAgeGateWrites({
    schema: info.schema,
    mutationName: info.fieldName,
    args,
  });

  if (unsafe.length > 0) {
    if (isEnforcing()) {
      throw new GraphQLError(
        "This change could expose age-restricted content and isn't supported through this operation.",
        { extensions: { code: AGE_GATE_UNSAFE_WRITE_ERROR_CODE, writes: unsafe } }
      );
    }
    logger.warn("age-gate write validator: unhandled write (log-only)", {
      mutation: info.fieldName,
      writes: unsafe,
    });
  }

  return resolve(parent, args, context, info);
};

const ageGateWriteValidatorMiddleware = {
  Mutation: validateAgeGateWrites,
};

export default ageGateWriteValidatorMiddleware;
