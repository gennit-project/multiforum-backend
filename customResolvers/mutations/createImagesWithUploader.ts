import { GraphQLError } from "graphql";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";

type Args = {
  input: any[];
};

type Input = {
  Image: any;
  User: any;
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

  return async (parent: any, args: Args, context: any, info: any) => {
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
      const { Uploader, ...rest } = imageInput || {};
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
        input: sanitizedInputs,
        selectionSet: `{ images ${selectionSet} }`,
      });

      return response;
    } catch (error: any) {
      console.error("Error creating images:", error);
      throw new GraphQLError(`Failed to create images: ${error.message}`);
    }
  };
};

export default getResolver;
