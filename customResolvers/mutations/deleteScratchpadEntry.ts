import type { ScratchpadRepository } from "../../services/persistence/scratchpadRepository.js";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";

type Input = {
  scratchpadRepository: ScratchpadRepository;
};

type Args = {
  scratchpadEntryId: string;
};

const deleteScratchpadEntryResolver = (input: Input) => {
  const { scratchpadRepository } = input;

  return async (parent: unknown, args: Args, context: GraphQLContext, resolveInfo: GraphQLResolveInfo) => {
    const { scratchpadEntryId } = args;

    // Get logged in user from context
    const loggedInUsername = context.user?.username;
    if (!loggedInUsername) {
      throw new Error('You must be logged in to delete a scratchpad entry');
    }

    if (!scratchpadEntryId) {
      throw new Error('scratchpadEntryId is required');
    }

    // Find the entry and verify ownership
    const entryResult = await scratchpadRepository.findOwnership(scratchpadEntryId);

    if (entryResult.length === 0) {
      throw new Error('Scratchpad entry not found');
    }

    const entry = entryResult[0];

    // Only the recipient can delete the entry
    if (entry.Recipient?.username !== loggedInUsername) {
      throw new Error('Only the recipient can delete a scratchpad entry');
    }

    // Delete the entry
    // Note: This does NOT undo the super upvote - the super upvote relationship remains
    await scratchpadRepository.deleteEntry(scratchpadEntryId);

    return true;
  };
};

export default deleteScratchpadEntryResolver;
