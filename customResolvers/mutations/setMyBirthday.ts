import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import {
  calculateAge,
  getAgeEligibility,
  loadAgePolicy,
} from "../../services/agePolicy.js";
import type { ServerConfigModel } from "../../ogm_types.js";

type Input = {
  driver: Driver;
  ServerConfig: ServerConfigModel;
};

type Args = { birthday: string };

const setMyBirthday = ({ driver, ServerConfig }: Input) => async (
  _parent: unknown,
  { birthday }: Args,
  context: GraphQLContext
) => {
  context.user = await setUserDataOnContext({ context });
  const username = context.user?.username;
  if (!username) throw new Error("Authentication required");

  const age = calculateAge(birthday);
  if (age === null || age < 0) throw new Error("INVALID_BIRTHDAY");

  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (user:User {username: $username})
       SET user.dateOfBirth = coalesce(user.dateOfBirth, date($birthday))
       RETURN toString(user.dateOfBirth) AS birthday`,
      { username, birthday }
    );
    const storedBirthday = result.records[0]?.get("birthday");
    if (!storedBirthday) throw new Error("Account not found");
    if (storedBirthday !== birthday) {
      throw new Error("BIRTHDAY_ALREADY_SET");
    }

    const policy = await loadAgePolicy(ServerConfig);
    return {
      birthday: storedBirthday,
      ...getAgeEligibility({ birthday: storedBirthday, policy }),
    };
  } finally {
    await session.close();
  }
};

export default setMyBirthday;
