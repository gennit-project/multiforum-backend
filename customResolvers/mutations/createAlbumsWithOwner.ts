import { GraphQLError } from "graphql";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { sanitizeAlbumCreateInput } from "./utils/ownershipSanitizers.js";

type Args = {
  input: any[];
};

type Input = {
  Album: any;
  User: any;
};

const selectionSet = `
  {
    id
    imageOrder
    Owner {
      username
    }
    Images {
      id
      url
      alt
      caption
      copyright
    }
    Discussions {
      id
    }
  }
`;

const getResolver = (input: Input) => {
  const { Album, User } = input;

  return async (parent: any, args: Args, context: any, info: any) => {
    const { input: albumInputs } = args;

    context.user = await setUserDataOnContext({
      context,
      getPermissionInfo: false,
    });

    const username = context.user?.username;

    if (!username) {
      throw new GraphQLError("You must be logged in to create albums.");
    }

    const users = await User.find({
      where: { username },
      selectionSet: `{ username }`,
    });

    if (users.length === 0) {
      throw new GraphQLError("Could not find the album owner.");
    }

    const sanitizedInputs = (albumInputs || []).map((albumInput) =>
      sanitizeAlbumCreateInput(albumInput, username)
    );

    try {
      const response = await Album.create({
        input: sanitizedInputs,
        selectionSet: `{ albums ${selectionSet} }`,
      });

      return response;
    } catch (error: any) {
      console.error("Error creating albums:", error);
      throw new GraphQLError(`Failed to create albums: ${error.message}`);
    }
  };
};

export default getResolver;
