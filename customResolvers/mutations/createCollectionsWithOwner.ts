import { GraphQLError, type GraphQLResolveInfo } from "graphql";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { sanitizeCollectionCreateInput } from "./utils/ownershipSanitizers.js";
import type { GraphQLContext } from "../../types/context.js";
import type { CollectionCreateInput, CollectionModel, UserModel } from "../../ogm_types.js";
import { logger } from "../../logger.js";

type Args = {
  input: CollectionCreateInput[];
};

type Input = {
  Collection: CollectionModel;
  User: UserModel;
};

const selectionSet = `
  {
    id
    name
    description
    visibility
    collectionType
    itemOrder
    createdAt
    updatedAt
    CreatedBy {
      username
    }
  }
`;

const getResolver = (input: Input) => {
  const { Collection, User } = input;

  return async (parent: unknown, args: Args, context: GraphQLContext, info: GraphQLResolveInfo) => {
    const { input: collectionInputs } = args;

    context.user = await setUserDataOnContext({
      context,
    });

    const username = context.user?.username;

    if (!username) {
      throw new GraphQLError("You must be logged in to create collections.");
    }

    const users = await User.find({
      where: { username },
      selectionSet: `{ username }`,
    });

    if (users.length === 0) {
      throw new GraphQLError("Could not find the collection owner.");
    }

    const sanitizedInputs = (collectionInputs || []).map((collectionInput) =>
      sanitizeCollectionCreateInput(collectionInput, username)
    );

    try {
      const response = await Collection.create({
        input: sanitizedInputs,
        selectionSet: `{ collections ${selectionSet} }`,
      });

      return response;
    } catch (error: unknown) {
      logger.error("Error creating collections:", error);
      const message = error instanceof Error ? error.message : String(error);
      throw new GraphQLError(`Failed to create collections: ${message}`);
    }
  };
};

export default getResolver;
