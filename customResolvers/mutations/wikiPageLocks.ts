import { GraphQLError } from "graphql";
import type { WikiPageModel } from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";
import {
  assertCanManageLockedWikiPage,
  getWikiPageById,
  validateWikiPageChannelEnabled,
} from "../../rules/definitions/wikiRules.js";

type LockWikiPageArgs = {
  wikiPageId: string;
  reason: string;
};

type UnlockWikiPageArgs = {
  wikiPageId: string;
};

type Deps = {
  WikiPage: WikiPageModel;
};

const requireWikiPageId = (wikiPageId?: string | null) => {
  if (!wikiPageId) {
    throw new GraphQLError("A wiki page is required.");
  }
};

export const lockWikiPage = ({ WikiPage }: Deps) => {
  return async (_parent: unknown, args: LockWikiPageArgs, context: GraphQLContext) => {
    requireWikiPageId(args.wikiPageId);

    if (!args.reason || !args.reason.trim()) {
      throw new GraphQLError("A reason is required to lock a wiki page.");
    }

    const wikiPage = await getWikiPageById(args.wikiPageId, context);

    if (!wikiPage) {
      throw new GraphQLError("Wiki page not found.");
    }

    if (wikiPage.locked) {
      throw new GraphQLError("Wiki page is already locked.");
    }

    await validateWikiPageChannelEnabled(wikiPage.channelUniqueName, context);
    await assertCanManageLockedWikiPage(wikiPage.channelUniqueName, context);

    const update = {
      locked: true,
      lockedAt: new Date().toISOString(),
      lockReason: args.reason.trim(),
      lockedByUsername: context.user?.username ?? null,
    } as Record<string, unknown>;

    const result = await WikiPage.update({
      where: { id: args.wikiPageId },
      update: update as never,
      selectionSet: `{
        wikiPages {
          id
          title
          body
          slug
          channelUniqueName
          locked
          lockedAt
          lockReason
          lockedByUsername
        }
      }`,
    });

    const updatedWikiPage = result.wikiPages[0];

    if (!updatedWikiPage) {
      throw new GraphQLError("Could not lock wiki page.");
    }

    return updatedWikiPage;
  };
};

export const unlockWikiPage = ({ WikiPage }: Deps) => {
  return async (_parent: unknown, args: UnlockWikiPageArgs, context: GraphQLContext) => {
    requireWikiPageId(args.wikiPageId);

    const wikiPage = await getWikiPageById(args.wikiPageId, context);

    if (!wikiPage) {
      throw new GraphQLError("Wiki page not found.");
    }

    if (!wikiPage.locked) {
      throw new GraphQLError("Wiki page is not locked.");
    }

    await validateWikiPageChannelEnabled(wikiPage.channelUniqueName, context);
    await assertCanManageLockedWikiPage(wikiPage.channelUniqueName, context);

    const update = {
      locked: false,
      lockedAt: null,
      lockReason: null,
      lockedByUsername: null,
    } as Record<string, unknown>;

    const result = await WikiPage.update({
      where: { id: args.wikiPageId },
      update: update as never,
      selectionSet: `{
        wikiPages {
          id
          title
          body
          slug
          channelUniqueName
          locked
          lockedAt
          lockReason
          lockedByUsername
        }
      }`,
    });

    const updatedWikiPage = result.wikiPages[0];

    if (!updatedWikiPage) {
      throw new GraphQLError("Could not unlock wiki page.");
    }

    return updatedWikiPage;
  };
};
