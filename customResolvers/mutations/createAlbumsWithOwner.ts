import { GraphQLError, type GraphQLResolveInfo } from "graphql";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { sanitizeAlbumCreateInput } from "./utils/ownershipSanitizers.js";
import type { GraphQLContext } from "../../types/context.js";
import type { AlbumCreateInput, AlbumModel, UserModel } from "../../ogm_types.js";

type Args = {
  input: AlbumCreateInput[];
};

type Input = {
  Album: AlbumModel;
  User: UserModel;
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

  return async (parent: unknown, args: Args, context: GraphQLContext, info: GraphQLResolveInfo) => {
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
        input: sanitizedInputs as unknown as AlbumCreateInput[],
        selectionSet: `{ albums ${selectionSet} }`,
      });

      return response;
    } catch (error: unknown) {
      console.error("Error creating albums:", error);
      const message = error instanceof Error ? error.message : String(error);
      throw new GraphQLError(`Failed to create albums: ${message}`);
    }
  };
};

export default getResolver;
