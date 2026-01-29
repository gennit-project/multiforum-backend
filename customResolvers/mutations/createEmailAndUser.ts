import { EmailModel, UserModel, UserCreateInput } from "../../ogm_types.js";
import { generateSlug } from "random-word-slugs";

type Args = {
  emailAddress: string;
  username: string;
};

type Input = {
  User: UserModel;
  Email: EmailModel;
};

/**
 * Function to create a user and link an email
 */
export const createUsersWithEmails = async (
  User: UserModel,
  Email: EmailModel,
  emailAddress: string,
  username: string
) => {
  if (!emailAddress || !username) {
    throw new Error("Both emailAddress and username are required");
  }
  if (username.toLowerCase().startsWith("bot-")) {
    throw new Error("Usernames starting with \"bot-\" are reserved");
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
  const { User, Email } = input;

  return async (parent: any, args: Args, context: any, resolveInfo: any) => {
    const { emailAddress, username } = args;

    try {
      // Use the extracted function to create a user
      const newUser = await createUsersWithEmails(User, Email, emailAddress, username);
      return newUser;
    } catch (e: any) {
      console.error(e);
      throw new Error(
        `An error occurred while creating the user and linking the email: ${e?.message}`
      );
    }
  };
};

export default getCreateEmailAndUserResolver;
