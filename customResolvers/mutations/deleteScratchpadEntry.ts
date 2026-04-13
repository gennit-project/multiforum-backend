type Input = {
  ScratchpadEntry: any;
};

type Args = {
  scratchpadEntryId: string;
};

const deleteScratchpadEntryResolver = (input: Input) => {
  const { ScratchpadEntry } = input;

  return async (parent: any, args: Args, context: any, resolveInfo: any) => {
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
    const entryResult = await ScratchpadEntry.find({
      where: { id: scratchpadEntryId },
      selectionSet: `{
        id
        Recipient {
          username
        }
      }`,
    });

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
    await ScratchpadEntry.delete({
      where: { id: scratchpadEntryId },
    });

    return true;
  };
};

export default deleteScratchpadEntryResolver;
