import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";
import type { ServerConfigModel } from "../../ogm_types.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { getAgeEligibility, loadAgePolicy } from "../../services/agePolicy.js";

type Input = {
  driver: Driver;
  ServerConfig: ServerConfigModel;
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

const NOT_REQUIRED: AgeGateCheck = {
  requiresAgeCheck: false,
  status: "ALLOWED",
  minimumAge: null,
};

const readOne = async <T>(params: {
  driver: Driver;
  query: string;
  values: Record<string, unknown>;
  key: string;
}): Promise<T | null> => {
  const session = params.driver.session({ defaultAccessMode: "READ" });
  try {
    const result = await session.run(params.query, params.values);
    return (result.records[0]?.get(params.key) as T | undefined) ?? null;
  } finally {
    await session.close();
  }
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
  ({ driver, ServerConfig }: Input) =>
  async (
    _parent: unknown,
    { discussionId }: Args,
    context: GraphQLContext
  ): Promise<AgeGateCheck> => {
    const policy = await loadAgePolicy(ServerConfig);
    if (!policy.sensitiveContentAgeGateEnabled) return NOT_REQUIRED;

    // Read the mark directly: the API's authorization filter hides the
    // discussion from exactly the viewers this check is for.
    const sensitive = await readOne<boolean>({
      driver,
      query: `MATCH (discussion:Discussion {id: $discussionId})
              RETURN coalesce(discussion.hasSensitiveContent, false) AS sensitive`,
      values: { discussionId },
      key: "sensitive",
    });
    if (!sensitive) return NOT_REQUIRED;

    const minimumAge = policy.minimumSensitiveContentAge;
    context.user = await setUserDataOnContext({ context });
    const username = context.user?.username;
    if (!username) {
      return { requiresAgeCheck: true, status: "SIGN_IN_REQUIRED", minimumAge };
    }

    const birthday = await readOne<string>({
      driver,
      query: `MATCH (user:User {username: $username})
              RETURN toString(user.dateOfBirth) AS birthday`,
      values: { username },
      key: "birthday",
    });
    if (!birthday) {
      return { requiresAgeCheck: true, status: "BIRTHDAY_REQUIRED", minimumAge };
    }

    return getAgeEligibility({ birthday, policy }).mayAccessSensitiveContent
      ? NOT_REQUIRED
      : { requiresAgeCheck: true, status: "UNDER_MINIMUM_AGE", minimumAge };
  };

export default getDiscussionAgeGateCheck;
