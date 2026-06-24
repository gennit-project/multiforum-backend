// Wiki-page graphql-shield rules and their channel-name resolution helpers.
// Extracted from rules/rules.ts.
import { rule } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";
import { ERROR_MESSAGES } from "../errorMessages.js";
import { checkChannelPermissions } from "../permission/hasChannelPermission.js";
import { checkChannelModPermissions, ModChannelPermission } from "../permission/hasChannelModPermission.js";
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
      OriginalAuthor {
        username
      }
      ChildPages {
        id
      }
    }`,
  })) as WikiPageLookup[];
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

export async function evaluateCanEditWikiPagesRule(
  args: WikiPageMutationArgs,
  ctx: GraphQLContext
) {
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

  if (!wikiHomePageUpdate) {
    return true;
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
