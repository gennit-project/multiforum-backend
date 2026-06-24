import type { GraphQLResolveInfo } from "graphql";
import type { ScratchpadEntryModel } from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";

type Input = {
  ScratchpadEntry: ScratchpadEntryModel;
};

type Args = {
  scratchpadEntryId: string;
  isPublic: boolean;
};

const updateScratchpadEntryVisibilityResolver = (input: Input) => {
  const { ScratchpadEntry } = input;

  return async (
    parent: unknown,
    args: Args,
    context: GraphQLContext,
    resolveInfo: GraphQLResolveInfo
  ) => {
    const { scratchpadEntryId, isPublic } = args;

    // Get logged in user from context
    const loggedInUsername = context.user?.username;
    if (!loggedInUsername) {
      throw new Error('You must be logged in to update a scratchpad entry');
    }

    if (!scratchpadEntryId) {
      throw new Error('scratchpadEntryId is required');
    }

    if (typeof isPublic !== 'boolean') {
      throw new Error('isPublic must be a boolean');
    }

    // Find the entry and verify ownership
    const entryResult = await ScratchpadEntry.find({
      where: { id: scratchpadEntryId },
      selectionSet: `{
        id
        isPublic
        text
        sourceType
        sourceId
        sourceChannelUniqueName
        createdAt
        Recipient {
          username
        }
        Author {
          username
          displayName
          profilePicURL
        }
      }`,
    });

    if (entryResult.length === 0) {
      throw new Error('Scratchpad entry not found');
    }

    const entry = entryResult[0];

    // Only the recipient can update visibility
    if (entry.Recipient?.username !== loggedInUsername) {
      throw new Error('Only the recipient can update the visibility of a scratchpad entry');
    }

    // Update the entry
    await ScratchpadEntry.update({
      where: { id: scratchpadEntryId },
      update: { isPublic },
    });

    return {
      ...entry,
      isPublic,
    };
  };
};

export default updateScratchpadEntryVisibilityResolver;
