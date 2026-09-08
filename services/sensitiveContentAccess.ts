import type { Driver } from "neo4j-driver";
import type { ServerConfigModel } from "../ogm_types.js";
import type { GraphQLContext } from "../types/context.js";
import { setUserDataOnContext } from "../rules/permission/userDataHelperFunctions.js";
import {
  DEFAULT_AGE_POLICY,
  getAgeEligibility,
  loadAgePolicy,
} from "./agePolicy.js";

type Input = {
  context?: GraphQLContext;
  driver: Driver;
  ServerConfig?: ServerConfigModel;
  now?: Date;
  serverName?: string;
};

/**
 * Resolve the sensitive-content decision once per GraphQL request.
 *
 * A disabled gate preserves the existing public behavior. When enabled, the
 * caller must be authenticated and have a stored birthday meeting the server's
 * configured minimum. No role receives an implicit bypass.
 */
export async function mayAccessSensitiveContent({
  context,
  driver,
  ServerConfig,
  now,
  serverName,
}: Input): Promise<boolean> {
  if (context?.mayAccessSensitiveContent !== undefined) {
    return context.mayAccessSensitiveContent;
  }

  const policy = ServerConfig
    ? await loadAgePolicy(ServerConfig, serverName)
    : DEFAULT_AGE_POLICY;

  if (!policy.sensitiveContentAgeGateEnabled) {
    if (context) context.mayAccessSensitiveContent = true;
    return true;
  }

  // GraphQL always supplies a context, but direct resolver consumers may not.
  // Treat a missing context as anonymous and fail closed when the gate is on.
  if (!context) return false;

  context.user = await setUserDataOnContext({ context });
  const username = context.user?.username;
  if (!username) {
    context.mayAccessSensitiveContent = false;
    return false;
  }

  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (user:User {username: $username})
       RETURN toString(user.dateOfBirth) AS birthday`,
      { username }
    );
    const birthday = result.records[0]?.get("birthday") ?? null;
    const access = getAgeEligibility({ birthday, policy, now })
      .mayAccessSensitiveContent;
    context.mayAccessSensitiveContent = access;
    return access;
  } finally {
    await session.close();
  }
}
