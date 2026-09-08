import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import {
  getAgeEligibility,
  loadAgePolicy,
} from "../../services/agePolicy.js";
import type { ServerConfigModel } from "../../ogm_types.js";

type Input = {
  driver: Driver;
  ServerConfig: ServerConfigModel;
};

const getMyAgeProfile = ({ driver, ServerConfig }: Input) => async (
  _parent: unknown,
  _args: unknown,
  context: GraphQLContext
) => {
  context.user = await setUserDataOnContext({ context });
  const username = context.user?.username;
  if (!username) return null;

  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (user:User {username: $username})
       RETURN toString(user.dateOfBirth) AS birthday`,
      { username }
    );
    const birthday = result.records[0]?.get("birthday") ?? null;
    const policy = await loadAgePolicy(ServerConfig);

    return {
      birthday,
      ...getAgeEligibility({ birthday, policy }),
    };
  } finally {
    await session.close();
  }
};

export default getMyAgeProfile;
