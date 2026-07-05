// Wiki-page graphql-shield rules and their channel-name resolution helpers.
// Extracted from rules/rules.ts.
import { rule } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";
import { ERROR_MESSAGES } from "../errorMessages.js";
import {
  checkChannelPermissions,
  evaluateChannelOwnerPermission,
  isChannelAdmin,
} from "../permission/hasChannelPermission.js";
import { checkChannelModPermissions, ModChannelPermission } from "../permission/hasChannelModPermission.js";
import { setUserDataOnContext } from "../permission/userDataHelperFunctions.js";
import {
  MutationCreateWikiPagesArgs,
  MutationDeleteWikiPagesArgs,
  MutationUpdateChannelsArgs,
  MutationUpdateWikiPagesArgs,
  WikiPageChildPagesUpdateFieldInput,
  WikiPageCreateInput,
  WikiPageWhere,
} from "../../src/generated/graphql.js";

type WikiPageLookup = {
  id?: string | null;
  channelUniqueName?: string | null;
  locked?: boolean | null;
  OriginalAuthor?: {
    username?: string | null;
  } | null;
  ChildPages?: Array<{
    id?: string | null;
  }> | null;
};

type WikiChannelPreference = {
  uniqueName?: string | null;
  wikiEnabled?: boolean | null;
  Admins?: Array<{ username?: string | null }> | null;
  ElevatedChannelRole?: {
    canUpdateChannel?: boolean | null;
  } | null;
};

type WikiPageMutationArgs = Partial<
  MutationCreateWikiPagesArgs &
    MutationUpdateWikiPagesArgs &
    MutationDeleteWikiPagesArgs
>;

type WikiPageChildPagesUpdate =
  | WikiPageChildPagesUpdateFieldInput
  | {
      create?: Array<{ node?: Pick<WikiPageCreateInput, "channelUniqueName"> }>;
    };

function addChannelName(
  channelNames: Set<string>,
  channelName?: string | null
) {
  if (channelName) {
    channelNames.add(channelName);
  }
}

function hasWikiPageWhere(where?: WikiPageWhere | null) {
  return !!where && Object.keys(where).length > 0;
}

async function getWikiPagesByWhere(where: WikiPageWhere | null, ctx: GraphQLContext) {
  if (!hasWikiPageWhere(where)) {
    return [];
  }

  const WikiPage = ctx.ogm.model("WikiPage");
  return (await WikiPage.find({
    where: where ?? undefined,
    selectionSet: `{
      id
      channelUniqueName
      locked
      OriginalAuthor {
        username
      }
      ChildPages {
        id
      }
    }`,
  })) as WikiPageLookup[];
}

export async function getWikiPageById(
  wikiPageId: string,
  ctx: GraphQLContext
) {
  const WikiPage = ctx.ogm.model("WikiPage");
  const wikiPages = (await WikiPage.find({
    where: { id: wikiPageId },
    selectionSet: `{
      id
      channelUniqueName
      locked
    }`,
  })) as WikiPageLookup[];

  return wikiPages[0] ?? null;
}

function collectWikiPageChannelNames(wikiPages: WikiPageLookup[]) {
  const channelNames = new Set<string>();

  wikiPages.forEach((wikiPage) => {
    addChannelName(channelNames, wikiPage.channelUniqueName);
  });

  return Array.from(channelNames);
}

async function getWikiPageChannelNamesByWhere(
  args: WikiPageMutationArgs,
  ctx: GraphQLContext
) {
  const channelNames = new Set<string>();
  const where = args?.where || null;

  addChannelName(channelNames, where?.channelUniqueName);

  const wikiPages = await getWikiPagesByWhere(where, ctx);
  collectWikiPageChannelNames(wikiPages).forEach((channelName) => {
    addChannelName(channelNames, channelName);
  });

  return Array.from(channelNames);
}

function getCreatedWikiPageChannelNames(
  input?: MutationCreateWikiPagesArgs["input"]
) {
  const channelNames = new Set<string>();
  const inputs = input || [];

  inputs.forEach((item) => {
    addChannelName(channelNames, item?.channelUniqueName);
  });

  return Array.from(channelNames);
}

function getChildPageCreateChannelNames(
  childPages?: MutationUpdateWikiPagesArgs["update"] extends infer T
    ? T extends { ChildPages?: infer U }
      ? U
      : never
    : never
) {
  const updates = Array.isArray(childPages)
    ? childPages
    : childPages
    ? ([childPages] as WikiPageChildPagesUpdate[])
    : [];

  return updates.flatMap(
    (update: WikiPageChildPagesUpdate) =>
      update.create
        ?.map((item) => item?.node?.channelUniqueName)
        .filter((channelName): channelName is string => !!channelName) || []
  );
}

async function validateWikiChannelsEnabled(
  channelConnections: string[],
  ctx: GraphQLContext
) {
  const Channel = ctx.ogm.model("Channel");
  const channelNames = Array.from(new Set(channelConnections.filter(Boolean)));

  for (const channelName of channelNames) {
    const channels = (await Channel.find({
      where: { uniqueName: channelName },
      selectionSet: `{
        uniqueName
        wikiEnabled
      }`,
    })) as WikiChannelPreference[];
    const channel = channels[0];

    if (channel?.wikiEnabled === false) {
      return new Error(`Wiki is disabled in channel '${channelName}'.`);
    }
  }

  return true;
}

export async function validateWikiPageChannelEnabled(
  channelName: string | null | undefined,
  ctx: GraphQLContext
) {
  if (!channelName) {
    throw new Error("No channel specified for this wiki page.");
  }

  const result = await validateWikiChannelsEnabled([channelName], ctx);

  if (result instanceof Error) {
    throw result;
  }
}

export async function assertCanManageLockedWikiPage(
  channelName: string | null | undefined,
  ctx: GraphQLContext
) {
  if (!channelName) {
    throw new Error("No channel specified for this wiki page.");
  }

  if (!ctx.user?.username) {
    ctx.user = await setUserDataOnContext({ context: ctx });
  }

  const username = ctx.user?.username;

  if (!username) {
    throw new Error(ERROR_MESSAGES.channel.notAuthenticated);
  }

  const Channel = ctx.ogm.model("Channel");
  const channels = (await Channel.find({
    where: { uniqueName: channelName },
    selectionSet: `{
      uniqueName
      Admins {
        username
      }
      ElevatedChannelRole {
        canUpdateChannel
      }
    }`,
  })) as WikiChannelPreference[];
  const channel = channels[0];

  if (!channel) {
    throw new Error(ERROR_MESSAGES.channel.notFound);
  }

  if (!isChannelAdmin(channel.Admins, username)) {
    throw new Error(ERROR_MESSAGES.channel.noChannelPermission);
  }

  if (!evaluateChannelOwnerPermission(channel.ElevatedChannelRole, "canUpdateChannel")) {
    throw new Error(ERROR_MESSAGES.channel.noChannelPermission);
  }

  return true;
}

async function validateLockedWikiPageEdits(
  wikiPages: WikiPageLookup[],
  ctx: GraphQLContext
) {
  const lockedChannelNames = Array.from(
    new Set(
      wikiPages
        .filter((wikiPage) => wikiPage.locked === true)
        .map((wikiPage) => wikiPage.channelUniqueName)
        .filter((channelName): channelName is string => !!channelName)
    )
  );

  for (const channelName of lockedChannelNames) {
    await assertCanManageLockedWikiPage(channelName, ctx);
  }
}

export async function evaluateCanEditWikiPagesRule(
  args: WikiPageMutationArgs,
  ctx: GraphQLContext
) {
  const wikiPages = await getWikiPagesByWhere(args?.where || null, ctx);
  const whereChannelNames = await getWikiPageChannelNamesByWhere(args, ctx);
  const createdChildChannelNames = getChildPageCreateChannelNames(
    args?.update?.ChildPages
  );
  const createdPageChannelNames = getCreatedWikiPageChannelNames(args?.input);
  const channelConnections = Array.from(
    new Set([
      ...whereChannelNames,
      ...createdChildChannelNames,
      ...createdPageChannelNames,
    ])
  );
  const wikiEnabledResult = await validateWikiChannelsEnabled(
    channelConnections,
    ctx
  );

  if (wikiEnabledResult instanceof Error) {
    return wikiEnabledResult;
  }

  try {
    await validateLockedWikiPageEdits(wikiPages, ctx);
  } catch (error) {
    return error instanceof Error ? error : new Error("Cannot edit locked wiki page.");
  }

  return checkChannelPermissions({
    channelConnections,
    context: ctx,
    permissionCheck: "canUpdateChannel",
  });
}

export async function evaluateCanEditWikiHomePageRule(
  args: MutationUpdateChannelsArgs,
  ctx: GraphQLContext
) {
  const wikiHomePageUpdate = args?.update?.WikiHomePage;

  // This rule only grants the wiki-home-page edit path. For any other channel
  // update it grants nothing (returns an Error) so it can be safely OR'd with
  // isChannelOwner/isAdmin in permissions.ts: general channel-config updates
  // must qualify as owner/admin, while wiki-home edits can additionally be done
  // by users with channel canUpdateChannel permission. Previously this returned
  // `true` for non-wiki updates, which — once OR'd — let ANY authenticated user
  // edit arbitrary channel settings.
  if (!wikiHomePageUpdate) {
    return new Error(ERROR_MESSAGES.channel.noChannelPermission);
  }

  const channelNames = new Set<string>();
  addChannelName(channelNames, args?.where?.uniqueName);
  addChannelName(
    channelNames,
    wikiHomePageUpdate?.create?.node?.channelUniqueName
  );
  addChannelName(
    channelNames,
    wikiHomePageUpdate?.update?.node?.channelUniqueName
  );
  const channelConnections = Array.from(channelNames);
  const wikiEnabledResult = await validateWikiChannelsEnabled(
    channelConnections,
    ctx
  );

  if (wikiEnabledResult instanceof Error) {
    return wikiEnabledResult;
  }

  const Channel = ctx.ogm.model("Channel");
  const channels = (await Channel.find({
    where: { uniqueName: args?.where?.uniqueName || "" },
    selectionSet: `{
      WikiHomePage {
        id
        channelUniqueName
        locked
      }
    }`,
  })) as Array<{ WikiHomePage?: WikiPageLookup | null }>;
  const wikiHomePage = channels[0]?.WikiHomePage;

  try {
    await validateLockedWikiPageEdits(wikiHomePage ? [wikiHomePage] : [], ctx);
  } catch (error) {
    return error instanceof Error ? error : new Error("Cannot edit locked wiki page.");
  }

  return checkChannelPermissions({
    channelConnections,
    context: ctx,
    permissionCheck: "canUpdateChannel",
  });
}

export async function evaluateCanDeleteWikiPagesRule(
  args: MutationDeleteWikiPagesArgs,
  ctx: GraphQLContext,
  checkModPermissions = checkChannelModPermissions
) {
  if (!hasWikiPageWhere(args?.where || null)) {
    return new Error("No wiki page specified for this operation.");
  }

  const wikiPages = await getWikiPagesByWhere(args?.where || null, ctx);

  if (!wikiPages.length) {
    return new Error("Could not find the wiki page or its associated channel.");
  }

  const currentUsername = ctx.user?.username || null;
  if (!currentUsername) {
    return new Error(ERROR_MESSAGES.channel.notAuthenticated);
  }

  const pagesWithChildren = wikiPages.filter(
    (wikiPage) => wikiPage.ChildPages?.length
  );

  if (pagesWithChildren.length) {
    return new Error(
      "Cannot delete a wiki page that has child pages. Delete child pages first."
    );
  }

  const userOwnsAllPages = wikiPages.every(
    (wikiPage) => wikiPage.OriginalAuthor?.username === currentUsername
  );

  if (userOwnsAllPages) {
    return true;
  }

  const channelConnections = collectWikiPageChannelNames(wikiPages);

  if (!channelConnections.length) {
    return new Error("No channel specified for this operation.");
  }

  const permissionResult = await checkModPermissions({
    channelConnections,
    context: ctx,
    permissionCheck: ModChannelPermission.canDeleteWiki,
  });

  if (permissionResult instanceof Error) {
    return permissionResult;
  }

  return true;
}

export const canEditWikiPages = rule({ cache: "contextual" })(
  async (parent: unknown, args: WikiPageMutationArgs, ctx: GraphQLContext, info: GraphQLResolveInfo) =>
    evaluateCanEditWikiPagesRule(args, ctx)
);

export const canDeleteWikiPages = rule({ cache: "contextual" })(
  async (parent: unknown, args: MutationDeleteWikiPagesArgs, ctx: GraphQLContext, info: GraphQLResolveInfo) =>
    evaluateCanDeleteWikiPagesRule(args, ctx)
);

export const canEditWikiHomePage = rule({ cache: "contextual" })(
  async (parent: unknown, args: MutationUpdateChannelsArgs, ctx: GraphQLContext, info: GraphQLResolveInfo) =>
    evaluateCanEditWikiHomePageRule(args, ctx)
);
