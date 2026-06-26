import type { Driver } from 'neo4j-driver';
import type { GraphQLResolveInfo } from 'graphql';
import type { GraphQLContext } from '../../types/context.js';
import { logger } from "../../logger.js";
import type {
  ScratchpadEntryModel,
  CommentModel,
  DiscussionChannelModel,
  UserModel,
} from '../../ogm_types.js';

type Input = {
  ScratchpadEntry: ScratchpadEntryModel;
  Comment: CommentModel;
  DiscussionChannel: DiscussionChannelModel;
  User: UserModel;
  driver: Driver;
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

  return async (parent: unknown, args: Args, context: GraphQLContext, resolveInfo: GraphQLResolveInfo) => {
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

      // 2. Verify the logged-in user has already upvoted the source content.
      //    Also capture where the content lives so the notification can link
      //    directly to the upvoted post/comment.
      let hasUpvoted = false;
      let hasSuperUpvoted = false;
      let postDiscussionId: string | null = null;
      let postChannelUniqueName: string | null = sourceChannelUniqueName || null;

      if (sourceType === 'comment') {
        const commentResult = await Comment.find({
          where: { id: sourceId },
          selectionSet: `{
            id
            UpvotedByUsers { username }
            SuperUpvotedByUsers { username }
            DiscussionChannel { discussionId channelUniqueName }
          }`,
        });

        if (commentResult.length === 0) {
          throw new Error('Comment not found');
        }

        const comment = commentResult[0];
        hasUpvoted = comment.UpvotedByUsers?.some((u: { username: string }) => u.username === loggedInUsername) || false;
        hasSuperUpvoted = comment.SuperUpvotedByUsers?.some((u: { username: string }) => u.username === loggedInUsername) || false;
        postDiscussionId = comment.DiscussionChannel?.discussionId || null;
        postChannelUniqueName =
          comment.DiscussionChannel?.channelUniqueName || postChannelUniqueName;
      } else {
        // sourceType === 'discussion'
        const dcResult = await DiscussionChannel.find({
          where: { id: sourceId },
          selectionSet: `{
            id
            discussionId
            channelUniqueName
            UpvotedByUsers { username }
            SuperUpvotedByUsers { username }
          }`,
        });

        if (dcResult.length === 0) {
          throw new Error('Discussion not found');
        }

        const dc = dcResult[0];
        hasUpvoted = dc.UpvotedByUsers?.some((u: { username: string }) => u.username === loggedInUsername) || false;
        hasSuperUpvoted = dc.SuperUpvotedByUsers?.some((u: { username: string }) => u.username === loggedInUsername) || false;
        postDiscussionId = dc.discussionId || null;
        postChannelUniqueName = dc.channelUniqueName || postChannelUniqueName;
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
            sourceChannelUniqueName:
              sourceChannelUniqueName || postChannelUniqueName || null,
            discussionId: postDiscussionId || null,
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

      // 5. Notify the recipient. Build a working link to the upvoted content
      //    plus a link to their Kudos page, and connect the notification to the
      //    scratchpad entry so the recipient can show-on-profile / ignore it
      //    straight from the notification. Created inside the transaction so the
      //    notification is atomic with the super upvote.
      const truncatedText = text.length > 50 ? text.substring(0, 50) + '...' : text;
      const subject = sourceType === 'comment' ? 'comment' : 'post';
      const kudosUrl = `/u/${recipientUsername}/scratchpad`;
      const postUrl =
        postDiscussionId && postChannelUniqueName
          ? `/forums/${postChannelUniqueName}/discussions/${postDiscussionId}`
          : kudosUrl;
      const notificationText =
        `[@${loggedInUsername}](/u/${loggedInUsername}) super upvoted your ` +
        `[${subject}](${postUrl}) with a thank-you note: "${truncatedText}" — ` +
        `[View on your Kudos page](${kudosUrl})`;

      await tx.run(
        `MATCH (recipient:User { username: $recipientUsername })
         MATCH (entry:ScratchpadEntry { id: $entryId })
         CREATE (recipient)-[:HAS_NOTIFICATION]->(n:Notification {
           id: randomUUID(),
           createdAt: datetime(),
           read: false,
           text: $notificationText,
           notificationType: 'scratchpad'
         })
         CREATE (n)-[:NOTIFICATION_FOR_SCRATCHPAD_ENTRY]->(entry)
         RETURN n`,
        {
          recipientUsername,
          entryId: createdEntry.id,
          notificationText,
        }
      );

      // Read the updated super-upvoter list inside the same transaction so it
      // always reflects the relationship we just created. A post-commit read on
      // a fresh OGM session can lag behind the write on a clustered database,
      // returning a stale list that omits the actor — which left the frontend
      // super-upvote button looking inactive (and un-undoable).
      const readSuperUpvotersQuery =
        sourceType === 'comment'
          ? `MATCH (u:User)-[:SUPER_UPVOTED_COMMENT]->(:Comment { id: $sourceId })
             RETURN collect({ username: u.username }) AS users`
          : `MATCH (u:User)-[:SUPER_UPVOTED_DISCUSSION]->(:DiscussionChannel { id: $sourceId })
             RETURN collect({ username: u.username }) AS users`;
      const superUpvotersResult = await tx.run(readSuperUpvotersQuery, { sourceId });
      const superUpvotedByUsers: Array<{ username: string }> =
        superUpvotersResult.records[0]?.get('users') || [];

      await tx.commit();

      // Return the created entry with author info and updated super upvoted users
      return {
        id: createdEntry.id,
        createdAt: createdEntry.createdAt,
        text: createdEntry.text,
        isPublic: createdEntry.isPublic,
        sourceType: createdEntry.sourceType,
        sourceId: createdEntry.sourceId,
        sourceChannelUniqueName: createdEntry.sourceChannelUniqueName,
        discussionId: createdEntry.discussionId,
        Author: {
          username: loggedInUsername,
        },
        Recipient: {
          username: recipientUsername,
        },
        superUpvotedByUsers,
      };
    } catch (e) {
      if (tx) {
        try {
          await tx.rollback();
        } catch (rollbackError) {
          logger.error('Failed to rollback transaction', rollbackError);
        }
      }
      throw e;
    } finally {
      if (session) {
        try {
          await session.close();
        } catch (sessionCloseError) {
          logger.error('Failed to close session', sessionCloseError);
        }
      }
    }
  };
};

export default createScratchpadEntryResolver;
