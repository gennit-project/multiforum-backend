import { GraphQLError, type GraphQLResolveInfo } from "graphql";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import type { GraphQLContext } from "../../types/context.js";
import type { ImageCreateInput, ImageModel, UserModel } from "../../ogm_types.js";

type Args = {
  input: ImageCreateInput[];
};

type Input = {
  Image: ImageModel;
  User: UserModel;
};

const selectionSet = `
  {
    id
    url
    alt
    caption
    longDescription
    copyright
    createdAt
    hasSensitiveContent
    hasSpoiler
    scanStatus
    Uploader {
      username
    }
    Album {
      id
    }
  }
`;

const getResolver = (input: Input) => {
  const { Image, User } = input;

  return async (parent: unknown, args: Args, context: GraphQLContext, info: GraphQLResolveInfo) => {
    const { input: imageInputs } = args;

    context.user = await setUserDataOnContext({
      context,
      getPermissionInfo: false,
    });

    const username = context.user?.username;

    if (!username) {
      throw new GraphQLError("You must be logged in to upload images.");
    }

    const users = await User.find({
      where: { username },
      selectionSet: `{ username }`,
    });

    if (users.length === 0) {
      throw new GraphQLError("Could not find the original uploader of this image.");
    }

    const sanitizedInputs = (imageInputs || []).map((imageInput) => {
      const { Uploader, ...rest } = imageInput || ({} as ImageCreateInput);
      return {
        ...rest,
        Uploader: {
          connect: {
            where: {
              node: {
                username,
              },
            },
          },
        },
      };
    });

    try {
      const response = await Image.create({
        input: sanitizedInputs as unknown as ImageCreateInput[],
        selectionSet: `{ images ${selectionSet} }`,
      });

      return response;
    } catch (error: unknown) {
      console.error("Error creating images:", error);
      const message = error instanceof Error ? error.message : String(error);
      throw new GraphQLError(`Failed to create images: ${message}`);
    }
  };
};

export default getResolver;
