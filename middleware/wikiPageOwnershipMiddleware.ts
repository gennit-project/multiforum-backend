import { resolveWikiGuardRepository } from "../services/persistence/wikiGuardRepository.js";
import { GraphQLError, type GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../types/context.js";

type Resolver = (
  parent: unknown,
  args: Record<string, any>,
  context: GraphQLContext,
  info: GraphQLResolveInfo
) => Promise<unknown>;


const channelConnection = (channelUniqueName: string) => ({
  connect: {
    where: { node: { uniqueName: channelUniqueName } },
  },
});

export const attachWikiPageOwner = (
  input: Record<string, any>,
  channelUniqueName: string
) => {
  if (!channelUniqueName) {
    throw new GraphQLError("A channel is required when creating a wiki page.");
  }
  if (input.channelUniqueName && input.channelUniqueName !== channelUniqueName) {
    throw new GraphQLError("Wiki page ownership must match its route channel.");
  }
  const ownedInput: Record<string, any> = {
    ...input,
    channelUniqueName,
    Channel: channelConnection(channelUniqueName),
  };
  if (input.ChildPages) {
    const nested = mapNestedCreates(input.ChildPages, channelUniqueName);
    ownedInput.ChildPages = Array.isArray(input.ChildPages) ? nested : nested[0];
  }
  return ownedInput;
};

const findSingleOwner = async (
  where: Record<string, unknown> | undefined,
  context: GraphQLContext
) => {
  const pages = await resolveWikiGuardRepository(context).findChildCreationOwners(where);
  const owners = new Set(
    pages.map((page) => page.Channel?.uniqueName).filter(Boolean) as string[]
  );
  if (pages.length === 0 || owners.size !== 1) {
    throw new GraphQLError(
      "Child wiki pages can only be created for pages with one channel owner."
    );
  }
  return [...owners][0];
};

const mapNestedCreates = (value: any, channelUniqueName: string) => {
  const updates = Array.isArray(value) ? value : value ? [value] : [];
  return updates.map((update) => ({
    ...update,
    create: update.create?.map((entry: any) => ({
      ...entry,
      node: attachWikiPageOwner(entry.node ?? {}, channelUniqueName),
    })),
  }));
};

export const createWikiPagesWithOwners = async (
  resolve: Resolver,
  parent: unknown,
  args: Record<string, any>,
  context: GraphQLContext,
  info: GraphQLResolveInfo
) => resolve(
  parent,
  {
    ...args,
    input: (args.input ?? []).map((input: Record<string, any>) =>
      attachWikiPageOwner(input, input.channelUniqueName)
    ),
  },
  context,
  info
);

export const createOwnedChildWikiPages = async (
  resolve: Resolver,
  parent: unknown,
  args: Record<string, any>,
  context: GraphQLContext,
  info: GraphQLResolveInfo
) => {
  if (!args.update?.ChildPages?.create && !Array.isArray(args.update?.ChildPages)) {
    return resolve(parent, args, context, info);
  }
  const owner = await findSingleOwner(args.where, context);
  const nested = mapNestedCreates(args.update.ChildPages, owner);
  return resolve(
    parent,
    {
      ...args,
      update: {
        ...args.update,
        ChildPages: Array.isArray(args.update.ChildPages) ? nested : nested[0],
      },
    },
    context,
    info
  );
};

export const createOwnedWikiHomePage = async (
  resolve: Resolver,
  parent: unknown,
  args: Record<string, any>,
  context: GraphQLContext,
  info: GraphQLResolveInfo
) => {
  const create = args.update?.WikiHomePage?.create;
  if (!create) return resolve(parent, args, context, info);
  const channelUniqueName = args.where?.uniqueName;
  if (!channelUniqueName) {
    throw new GraphQLError(
      "A single channel uniqueName is required when creating a wiki home page."
    );
  }
  return resolve(
    parent,
    {
      ...args,
      update: {
        ...args.update,
        WikiHomePage: {
          ...args.update.WikiHomePage,
          create: {
            ...create,
            node: attachWikiPageOwner(create.node ?? {}, channelUniqueName),
          },
        },
      },
    },
    context,
    info
  );
};

export default {
  Mutation: {
    createWikiPages: createWikiPagesWithOwners,
    updateWikiPages: createOwnedChildWikiPages,
    updateChannels: createOwnedWikiHomePage,
  },
};
