import { rememberCanonicalSource } from "../../services/canonicalSourceFields.js";
import type { AgePolicyReader } from "../../services/persistence/instancePolicyRepository.js";
import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";

import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { getAgeEligibility, loadAgePolicy } from "../../services/agePolicy.js";

type Input = {
  driver: Driver;
  agePolicyRepository: AgePolicyReader;
};

type Args = {
  discussionId: string;
};

export type AgeGateCheckStatus =
  | "ALLOWED"
  | "SIGN_IN_REQUIRED"
  | "BIRTHDAY_REQUIRED"
  | "UNDER_MINIMUM_AGE";

export type AgeGateCheck = {
  requiresAgeCheck: boolean;
  status: AgeGateCheckStatus;
  minimumAge: number | null;
};

const NOT_REQUIRED: AgeGateCheck = rememberCanonicalSource({
  requiresAgeCheck: false,
  status: "ALLOWED",
  minimumAge: null,
});

// The sensitive property is intentionally unknown: its existing truthiness,
// rather than a new Boolean coercion policy, controls this check.
const readSensitive = async (driver: Driver, discussionId: string): Promise<unknown> => {
  const session = driver.session({ defaultAccessMode: "READ" });
  try {
    const result = await session.run<{ sensitive: unknown }>(
      `MATCH (discussion:Discussion {id: $discussionId})
              RETURN coalesce(discussion.hasSensitiveContent, false) AS sensitive`,
      { discussionId }
    );
    return result.records[0]?.get("sensitive") ?? null;
  } finally { await session.close(); }
};
const readBirthday = async (driver: Driver, username: string): Promise<string | null> => {
  const session = driver.session({ defaultAccessMode: "READ" });
  try {
    // The result type follows this fixed Cypher toString expression, not a
    // caller-chosen generic assertion over arbitrary database properties.
    const result = await session.run<{ birthday: string | null }>(
      `MATCH (user:User {username: $username})
              RETURN toString(user.dateOfBirth) AS birthday`,
      { username }
    );
    return result.records[0]?.get("birthday") ?? null;
  } finally { await session.close(); }
};

/**
 * Tells a detail page whether a discussion it couldn't load is behind the
 * sensitive-content age gate, and what the viewer needs to get past it
 * (docs/age-gate-materialization-design.md, "Just-in-time age check").
 *
 * The discussion query hides restricted discussions entirely, so without this
 * the page can only say "not found". This returns no content fields, since
 * even the title may be the sensitive part. It reveals only that a marked
 * discussion with this id exists, and only while the gate is on.
 */
const getDiscussionAgeGateCheck =
  ({ driver, agePolicyRepository }: Input) =>
  async (
    _parent: unknown,
    { discussionId }: Args,
    context: GraphQLContext
  ): Promise<AgeGateCheck> => {
    const policy = await loadAgePolicy(agePolicyRepository);
    if (!policy.sensitiveContentAgeGateEnabled) return NOT_REQUIRED;

    // Read the mark directly: the API's authorization filter hides the
    // discussion from exactly the viewers this check is for.
    const sensitive = await readSensitive(driver, discussionId);
    if (!sensitive) return NOT_REQUIRED;

    const minimumAge = policy.minimumSensitiveContentAge;
    context.user = await setUserDataOnContext({ context });
    const username = context.user?.username;
    if (!username) {
      return rememberCanonicalSource({ requiresAgeCheck: true, status: "SIGN_IN_REQUIRED", minimumAge });
    }

    const birthday = await readBirthday(driver, username);
    if (!birthday) {
      return rememberCanonicalSource({ requiresAgeCheck: true, status: "BIRTHDAY_REQUIRED", minimumAge });
    }

    return getAgeEligibility({ birthday, policy }).mayAccessSensitiveContent
      ? NOT_REQUIRED
      : rememberCanonicalSource({ requiresAgeCheck: true, status: "UNDER_MINIMUM_AGE", minimumAge });
  };

export default getDiscussionAgeGateCheck;
