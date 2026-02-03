import { GraphQLError } from 'graphql';
import { setUserDataOnContext } from '../../rules/permission/userDataHelperFunctions.js';
import { ERROR_MESSAGES } from '../../rules/errorMessages.js';

// Input type for image creation (excluding Uploader since we set it automatically)
type ImageInput = {
  url?: string;
  alt?: string;
  caption?: string;
  longDescription?: string;
  copyright?: string;
  hasSensitiveContent?: boolean;
  hasSpoiler?: boolean;
  albumId?: string;
};

type Args = {
  input: ImageInput;
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
    const { input: imageInput } = args;

    // Get the logged-in user from context
    context.user = await setUserDataOnContext({
      context,
      getPermissionInfo: false,
    });

    const username = context.user?.username;

    if (!username) {
      throw new GraphQLError('You must be logged in to upload images.');
    }

    // Verify the user exists in the database
    const users = await User.find({
      where: { username },
      selectionSet: `{ username }`,
    });

    if (users.length === 0) {
      throw new GraphQLError(ERROR_MESSAGES.image.noUploader);
    }

    // Build the create input with the Uploader relationship
    const createInput: any = {
      url: imageInput.url,
      alt: imageInput.alt,
      caption: imageInput.caption,
      longDescription: imageInput.longDescription,
      copyright: imageInput.copyright,
      hasSensitiveContent: imageInput.hasSensitiveContent,
      hasSpoiler: imageInput.hasSpoiler,
      // Connect the Uploader relationship to the logged-in user
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

    // If an albumId is provided, connect the Album relationship
    if (imageInput.albumId) {
      createInput.Album = {
        connect: {
          where: {
            node: {
              id: imageInput.albumId,
            },
          },
        },
      };
    }

    try {
      const response = await Image.create({
        input: [createInput],
        selectionSet: `{ images ${selectionSet} }`,
      });

      const createdImage = response.images[0];

      if (!createdImage) {
        throw new GraphQLError('Failed to create image.');
      }

      return createdImage;
    } catch (error: any) {
      console.error('Error creating image:', error);
      throw new GraphQLError(`Failed to create image: ${error.message}`);
    }
  };
};

export default getResolver;
