import { rule } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../../types/context.js";
import { ERROR_MESSAGES } from "../../errorMessages.js";
import { Collection, CollectionWhere } from "../../../src/generated/graphql.js";
import { setUserDataOnContext } from "../userDataHelperFunctions.js";

type IsCollectionOwnerArgs = {
  where?: CollectionWhere;
  collectionId?: string;
  id?: string;
  input?: {
    collectionId?: string;
  };
};

export const collectCollectionIds = (
  parent: { id?: string } | undefined,
  args: IsCollectionOwnerArgs
) => {
  const collectionIds: string[] = [];
  const whereArg = args?.where;

  if (whereArg?.id) {
    collectionIds.push(whereArg.id);
  }

  if (whereArg?.id_IN && Array.isArray(whereArg.id_IN)) {
    collectionIds.push(...whereArg.id_IN);
  }

  if (args?.collectionId) {
    collectionIds.push(args.collectionId);
  }

  if (args?.input?.collectionId) {
    collectionIds.push(args.input.collectionId);
  }

  if (args?.id) {
    collectionIds.push(args.id);
  }

  if (parent?.id && collectionIds.length === 0) {
    collectionIds.push(parent.id);
  }

  return [...new Set(collectionIds)];
};

export const isCollectionOwner = rule({ cache: "contextual" })(
  async (parent: { id?: string } | undefined, args: IsCollectionOwnerArgs, ctx: GraphQLContext, info: GraphQLResolveInfo) => {
    ctx.user = await setUserDataOnContext({
      context: ctx,
    });

    const username = ctx.user?.username;

    if (!username) {
      throw new Error(ERROR_MESSAGES.user.noUsername);
    }

    const collectionIds = collectCollectionIds(parent, args);

    if (collectionIds.length === 0) {
      throw new Error(ERROR_MESSAGES.collection.noId);
    }

    const CollectionModel = ctx.ogm.model("Collection");
    const whereClause: CollectionWhere =
      collectionIds.length === 1
        ? { id: collectionIds[0] }
        : { id_IN: collectionIds };

    const collections: Collection[] = await CollectionModel.find({
      where: whereClause,
      selectionSet: `{ id CreatedBy { username } }`,
    });

    if (!collections || collections.length === 0) {
      throw new Error(ERROR_MESSAGES.collection.notFound);
    }

    if (collections.length !== collectionIds.length) {
      throw new Error(ERROR_MESSAGES.collection.notFound);
    }

    const isOwner = collections.every(
      (collection) => collection?.CreatedBy?.username === username
    );

    if (!isOwner) {
      throw new Error(ERROR_MESSAGES.collection.notOwner);
    }

    return true;
  }
);
