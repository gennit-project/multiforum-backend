import { createInAppNotification } from '../../hooks/notificationHelpers.js';

type Input = {
  ScratchpadEntry: any;
  Comment: any;
  DiscussionChannel: any;
  User: any;
  driver: any;
};

type Args = {
  recipientUsername: string;
  text: string;
  sourceType: 'comment' | 'discussion';
  sourceId: string;
  sourceChannelUniqueName?: string;
};

const MAX_TEXT_LENGTH = 500;

const createScratchpadEntryResolver = (input: Input) => {
  const { ScratchpadEntry, Comment, DiscussionChannel, User, driver } = input;

  return async (parent: any, args: Args, context: any, resolveInfo: any) => {
    const { recipientUsername, text, sourceType, sourceId, sourceChannelUniqueName } = args;

    // Get logged in user from context
    const loggedInUsername = context.user?.username;
    if (!loggedInUsername) {
      throw new Error('You must be logged in to create a scratchpad entry');
    }

    if (!recipientUsername || !text || !sourceType || !sourceId) {
      throw new Error('recipientUsername, text, sourceType, and sourceId are required');
    }

    if (text.length > MAX_TEXT_LENGTH) {
      throw new Error(`Text must be ${MAX_TEXT_LENGTH} characters or less`);
    }

    if (text.trim().length === 0) {
      throw new Error('Text cannot be empty');
    }

    if (sourceType !== 'comment' && sourceType !== 'discussion') {
      throw new Error('sourceType must be "comment" or "discussion"');
    }

    if (loggedInUsername === recipientUsername) {
      throw new Error('You cannot write on your own scratchpad');
    }

    const session = driver.session();
    const tx = session.beginTransaction();

    try {
      // 1. Verify the recipient user exists
      const recipientResult = await User.find({
        where: { username: recipientUsername },
        selectionSet: `{ username displayName }`,
      });

      if (recipientResult.length === 0) {
        throw new Error('Recipient user not found');
      }

      // 2. Verify the logged-in user has already upvoted the source content
      let hasUpvoted = false;
      let hasSuperUpvoted = false;

      if (sourceType === 'comment') {
        const commentResult = await Comment.find({
          where: { id: sourceId },
          selectionSet: `{
            id
            UpvotedByUsers { username }
            SuperUpvotedByUsers { username }
          }`,
        });

        if (commentResult.length === 0) {
          throw new Error('Comment not found');
        }

        const comment = commentResult[0];
        hasUpvoted = comment.UpvotedByUsers?.some((u: any) => u.username === loggedInUsername) || false;
        hasSuperUpvoted = comment.SuperUpvotedByUsers?.some((u: any) => u.username === loggedInUsername) || false;
      } else {
        // sourceType === 'discussion'
        const dcResult = await DiscussionChannel.find({
          where: { id: sourceId },
          selectionSet: `{
            id
            UpvotedByUsers { username }
            SuperUpvotedByUsers { username }
          }`,
        });

        if (dcResult.length === 0) {
          throw new Error('Discussion not found');
        }

        const dc = dcResult[0];
        hasUpvoted = dc.UpvotedByUsers?.some((u: any) => u.username === loggedInUsername) || false;
        hasSuperUpvoted = dc.SuperUpvotedByUsers?.some((u: any) => u.username === loggedInUsername) || false;
      }

      if (!hasUpvoted) {
        throw new Error('You must upvote the content before you can super upvote');
      }

      if (hasSuperUpvoted) {
        throw new Error('You have already super upvoted this content');
      }

      // 3. Create the ScratchpadEntry
      const createEntryResult = await ScratchpadEntry.create({
        input: [
          {
            text: text.trim(),
            isPublic: false,
            sourceType,
            sourceId,
            sourceChannelUniqueName: sourceChannelUniqueName || null,
            Author: {
              connect: {
                where: { node: { username: loggedInUsername } },
              },
            },
            Recipient: {
              connect: {
                where: { node: { username: recipientUsername } },
              },
            },
          },
        ],
      });

      const createdEntry = createEntryResult.scratchpadEntries[0];

      // 4. Create the SUPER_UPVOTED relationship
      if (sourceType === 'comment') {
        const superUpvoteQuery = `
          MATCH (c:Comment { id: $sourceId }), (u:User { username: $username })
          CREATE (u)-[:SUPER_UPVOTED_COMMENT]->(c)
          SET c.weightedVotesCount = coalesce(c.weightedVotesCount, 0) + 1
          RETURN c
        `;
        await tx.run(superUpvoteQuery, { sourceId, username: loggedInUsername });
      } else {
        const superUpvoteQuery = `
          MATCH (dc:DiscussionChannel { id: $sourceId }), (u:User { username: $username })
          CREATE (u)-[:SUPER_UPVOTED_DISCUSSION]->(dc)
          SET dc.weightedVotesCount = coalesce(dc.weightedVotesCount, 0) + 1
          RETURN dc
        `;
        await tx.run(superUpvoteQuery, { sourceId, username: loggedInUsername });
      }

      // 5. Send notification to the recipient
      const truncatedText = text.length > 50 ? text.substring(0, 50) + '...' : text;
      const notificationText = `[@${loggedInUsername}](/u/${loggedInUsername}) wrote on your scratchpad: "${truncatedText}" [View scratchpad](/u/${recipientUsername}/scratchpad)`;

      await createInAppNotification({
        UserModel: User,
        username: recipientUsername,
        text: notificationText,
      });

      await tx.commit();

      // Return the created entry with author info
      return {
        id: createdEntry.id,
        createdAt: createdEntry.createdAt,
        text: createdEntry.text,
        isPublic: createdEntry.isPublic,
        sourceType: createdEntry.sourceType,
        sourceId: createdEntry.sourceId,
        sourceChannelUniqueName: createdEntry.sourceChannelUniqueName,
        Author: {
          username: loggedInUsername,
        },
        Recipient: {
          username: recipientUsername,
        },
      };
    } catch (e) {
      if (tx) {
        try {
          await tx.rollback();
        } catch (rollbackError) {
          console.error('Failed to rollback transaction', rollbackError);
        }
      }
      throw e;
    } finally {
      if (session) {
        try {
          await session.close();
        } catch (sessionCloseError) {
          console.error('Failed to close session', sessionCloseError);
        }
      }
    }
  };
};

export default createScratchpadEntryResolver;
