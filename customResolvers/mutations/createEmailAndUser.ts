import { EmailModel, ServerConfigModel, UserModel, UserCreateInput } from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";
import neo4j from "neo4j-driver";
import { generateSlug } from "random-word-slugs";
import { validateUserInput } from "../../rules/validation/userIsValid.js";
import { logger } from "../../logger.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import {
  DEFAULT_AGE_POLICY,
  type AgePolicy,
  loadAgePolicy,
  validateRegistrationBirthday,
} from "../../services/agePolicy.js";

type Args = {
  emailAddress: string;
  username: string;
  birthday?: string | null;
};

type Input = {
  User: UserModel;
  Email: EmailModel;
  ServerConfig: ServerConfigModel;
};

const toNeo4jDate = (birthday: string) => {
  const [year, month, day] = birthday.split("-").map(Number);
  return new neo4j.types.Date(year, month, day);
};

/**
 * Function to create a user and link an email
 */
export const createUsersWithEmails = async (
  User: UserModel,
  Email: EmailModel,
  emailAddress: string,
  username: string,
  birthday?: string | null,
  agePolicy: AgePolicy = DEFAULT_AGE_POLICY
) => {
  if (!emailAddress || !username) {
    throw new Error("Both emailAddress and username are required");
  }
  validateRegistrationBirthday({ birthday, policy: agePolicy });

  if (username.toLowerCase().startsWith("bot-")) {
    throw new Error("Usernames starting with \"bot-\" are reserved");
  }

  // Enforce username format/length rules at registration. The standard
  // createUsers mutation (which createUserInputIsValid guards) is denied, so
  // this custom registration path is where create-side validation must live.
  const usernameValidation = validateUserInput({ username, isEditMode: false });
  if (usernameValidation !== true) {
    throw new Error(usernameValidation);
  }

  // Check if the user already exists
  const existingUser = await User.find({
    where: { username },
  });

  if (existingUser.length > 0) {
    throw new Error("Username already taken");
  }

  // Check if the email already exists
  const existingEmail = await Email.find({
    where: { address: emailAddress },
  });

  if (existingEmail.length > 0) {
    throw new Error("Email already taken");
  }

  let newDisplayName = '';

  // if we are in a test environment
  if (process.env.SERVER_CONFIG_NAME === "Cypress Test Server") {
    if (username === "cluse") {
      newDisplayName = "testModProfile1";
    }
    else if (username === "alice") {
      newDisplayName = "testModProfile2";
    }
    else {
      newDisplayName = generateSlug(4, { format: "camel" });
    }
  } else {
    // Generate a random display name
    newDisplayName = generateSlug(4, { format: "camel" });
  }
  // Prepare user creation input
  const userCreateInput: UserCreateInput = {
    username,
    // Neo4j GraphQL 5 parses yyyy-mm-dd through JavaScript Date and then uses
    // local date components. On servers west of UTC that shifts the stored
    // birthday back one day. Construct the driver's date-only value directly.
    ...(birthday ? { dateOfBirth: toNeo4jDate(birthday) } : {}),
    Email: {
      create: {
        node: { address: emailAddress },
      },
    },
    ModerationProfile: {
      create: {
        node: { displayName: newDisplayName },
      },
    },
  };

  // Add admin role if email matches test admin email
  if (emailAddress === process.env.CYPRESS_ADMIN_TEST_EMAIL) {
    userCreateInput.ServerRoles = {
      connect: [
        {
          where: {
            node: { name: "Admin Role" },
          },
        },
      ],
    };
  }

  // Create the user
  await User.create({ input: [userCreateInput] });

  // Fetch and return the created user
  const newUserArray = await User.find({
    where: { username },
    selectionSet: `
    {
      username
      Email {
        address
      }
      ModerationProfile {
        displayName
      }
    }
    `,
  });

  if (newUserArray.length === 0) {
    throw new Error("Error creating user and linking email");
  }

  return newUserArray[0];
};

/**
 * Main resolver that uses createUsersWithEmails
 */
const getCreateEmailAndUserResolver = (input: Input) => {
  const { User, Email, ServerConfig } = input;

  return async (parent: unknown, args: Args, context: GraphQLContext, resolveInfo: GraphQLResolveInfo) => {
    const { emailAddress, username, birthday } = args;

    try {
      context.user = await setUserDataOnContext({ context });
      const verifiedEmail = context.user?.email;
      if (!verifiedEmail || !context.user?.email_verified) {
        throw new Error("A verified login is required to create an account");
      }
      if (verifiedEmail.toLowerCase() !== emailAddress.toLowerCase()) {
        throw new Error("Account email must match the verified login");
      }

      const agePolicy = await loadAgePolicy(ServerConfig);
      const newUser = await createUsersWithEmails(
        User,
        Email,
        verifiedEmail,
        username,
        birthday,
        agePolicy
      );
      return newUser;
    } catch (e: unknown) {
      logger.error(e);
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(
        `An error occurred while creating the user and linking the email: ${message}`
      );
    }
  };
};

export default getCreateEmailAndUserResolver;
