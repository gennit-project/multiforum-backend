import { rule } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../../types/context.js";
import { ERROR_MESSAGES } from "../../errorMessages.js";
import { Album, AlbumWhere } from "../../../src/generated/graphql.js";
import { setUserDataOnContext } from "../userDataHelperFunctions.js";

type IsAlbumOwnerArgs = {
  where?: AlbumWhere;
  albumId?: string;
  id?: string;
};

// Ownership check for album updates/deletes. Mirrors isCollectionOwner:
// createAlbums forces the Owner server-side, but update/delete are
// auto-generated mutations that accept an arbitrary `where`, so without this
// rule any authenticated user could edit or delete anyone's album.
export const isAlbumOwner = rule({ cache: "contextual" })(
  async (parent: { id?: string } | undefined, args: IsAlbumOwnerArgs, ctx: GraphQLContext, info: GraphQLResolveInfo) => {
    ctx.user = await setUserDataOnContext({
      context: ctx,
    });

    const username = ctx.user?.username;

    if (!username) {
      throw new Error(ERROR_MESSAGES.user.noUsername);
    }

    const albumIds: string[] = [];
    const whereArg = args?.where;

    if (whereArg?.id) {
      albumIds.push(whereArg.id);
    }

    if (whereArg?.id_IN && Array.isArray(whereArg.id_IN)) {
      albumIds.push(...whereArg.id_IN);
    }

    if (args?.albumId) {
      albumIds.push(args.albumId);
    }

    if (args?.id) {
      albumIds.push(args.id);
    }

    if (parent?.id && albumIds.length === 0) {
      albumIds.push(parent.id);
    }

    if (albumIds.length === 0) {
      throw new Error(ERROR_MESSAGES.album.noId);
    }

    const uniqueIds = [...new Set(albumIds)];

    const AlbumModel = ctx.ogm.model("Album");
    const whereClause: AlbumWhere =
      uniqueIds.length === 1
        ? { id: uniqueIds[0] }
        : { id_IN: uniqueIds };

    const albums: Album[] = await AlbumModel.find({
      where: whereClause,
      selectionSet: `{ id Owner { username } }`,
    });

    if (!albums || albums.length === 0) {
      throw new Error(ERROR_MESSAGES.album.notFound);
    }

    if (albums.length !== uniqueIds.length) {
      throw new Error(ERROR_MESSAGES.album.notFound);
    }

    const isOwner = albums.every(
      (album) => album?.Owner?.username === username
    );

    if (!isOwner) {
      throw new Error(ERROR_MESSAGES.album.notOwner);
    }

    return true;
  }
);
