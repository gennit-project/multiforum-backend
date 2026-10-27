import { GraphQLError, type GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../types/context.js";
import { stripTags, ownTags, type TagRunner } from "../services/persistence/tagOwnership.js";

// FAMILY-3 / v7 (campaign #284). Channels are created/updated through the
// generated createChannels / updateChannels (no custom resolver), so their
// owned writes live in middleware. v7 dropped connectOrCreate from the Tags
// field input, so a create-if-missing tag write can't be expressed there. This
// strips the Tags field before the generated mutation and owns the HAS_TAG
// edges (MERGE-ing each Tag by text) afterwards — the channel analogue of the
// discussion/event resolvers' owned tag write.

type Resolver = (
  parent: unknown,
  args: Record<string, any>,
  context: GraphQLContext,
  info: GraphQLResolveInfo
) => Promise<unknown>;

const runnerFor = (context: GraphQLContext): TagRunner => {
  const driver = context.driver;
  if (!driver) throw new GraphQLError("A driver is required to own channel tags.");
  return (cypher, params) => driver.executeQuery(cypher, params);
};

// v7 nests the filter as { uniqueName: { eq: "..." } }; tolerate a flat string.
const channelUniqueNameFromWhere = (where: Record<string, unknown> | undefined) => {
  const value = where?.uniqueName as string | { eq?: string | null } | null | undefined;
  const unique = typeof value === "string" ? value : value?.eq;
  return typeof unique === "string" && unique ? unique : null;
};

export const createChannelsWithOwnedTags = async (
  resolve: Resolver,
  parent: unknown,
  args: Record<string, any>,
  context: GraphQLContext,
  info: GraphQLResolveInfo
) => {
  const inputs = (args.input ?? []) as Array<Record<string, any>>;
  const perChannel = inputs.map((input) => {
    const { cleaned, tagTexts } = stripTags(input);
    return { uniqueName: input?.uniqueName as string | undefined, cleaned, tagTexts };
  });
  const hadAnyTags = perChannel.some((entry) => entry.tagTexts.length > 0);
  if (!hadAnyTags) return resolve(parent, args, context, info);

  const result = await resolve(
    parent,
    { ...args, input: perChannel.map((entry) => entry.cleaned) },
    context,
    info
  );

  const run = runnerFor(context);
  for (const entry of perChannel) {
    if (entry.tagTexts.length > 0 && entry.uniqueName) {
      await ownTags(run, { label: "Channel", uniqueName: entry.uniqueName }, entry.tagTexts);
    }
  }
  return result;
};

export const updateChannelsWithOwnedTags = async (
  resolve: Resolver,
  parent: unknown,
  args: Record<string, any>,
  context: GraphQLContext,
  info: GraphQLResolveInfo
) => {
  const { cleaned, tagTexts, hadTags } = stripTags(args.update ?? {});
  if (!hadTags) return resolve(parent, args, context, info);

  const uniqueName = channelUniqueNameFromWhere(args.where);
  if (!uniqueName) {
    throw new GraphQLError(
      "A single channel uniqueName is required when changing channel tags."
    );
  }

  const result = await resolve(parent, { ...args, update: cleaned }, context, info);
  await ownTags(runnerFor(context), { label: "Channel", uniqueName }, tagTexts, { replace: true });
  return result;
};

export default {
  Mutation: {
    createChannels: createChannelsWithOwnedTags,
    updateChannels: updateChannelsWithOwnedTags,
  },
};
