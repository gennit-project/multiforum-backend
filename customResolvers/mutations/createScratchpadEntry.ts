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
  // ScratchpadEntry intentionally unused: the entry is created via Cypher inside
  // the transaction (below) so it is atomic with the super-upvote/notification.
  const { Comment, DiscussionChannel, User, driver } = input;

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
      //    Also capture where the content lives (to link the notification to the
      //    upvoted post/comment) and who authored it (to award karma).
      let hasUpvoted = false;
      let hasSuperUpvoted = false;
      let postDiscussionId: string | null = null;
      let postChannelUniqueName: string | null = sourceChannelUniqueName || null;
      // The content author, if it is a User (ModerationProfile authors get no
      // karma, matching the normal upvote resolvers).
      let postAuthorUsername: string | null = null;

      if (sourceType === 'comment') {
        const commentResult = await Comment.find({
          where: { id: sourceId },
          selectionSet: `{
            id
            UpvotedByUsers { username }
            SuperUpvotedByUsers { username }
            DiscussionChannel { discussionId channelUniqueName }
            CommentAuthor {
              ... on User { username }
            }
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
        const commentAuthor = comment.CommentAuthor;
        postAuthorUsername =
          commentAuthor && 'username' in commentAuthor ? commentAuthor.username : null;
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
            Discussion { Author { username } }
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
        postAuthorUsername = dc.Discussion?.Author?.username || null;
      }

      if (!hasUpvoted) {
        throw new Error('You must upvote the content before you can super upvote');
      }

      if (hasSuperUpvoted) {
        throw new Error('You have already super upvoted this content');
      }

      // 3. Create the ScratchpadEntry node + Author/Recipient relationships in
      //    the transaction (not via OGM) so it is atomic with everything below.
      const createEntryResult = await tx.run(
        `MATCH (author:User { username: $loggedInUsername })
         MATCH (recipient:User { username: $recipientUsername })
         CREATE (author)-[:WROTE_SCRATCHPAD_ENTRY]->(e:ScratchpadEntry {
           id: randomUUID(),
           createdAt: datetime(),
           text: $text,
           isPublic: false,
           sourceType: $sourceType,
           sourceId: $sourceId,
           sourceChannelUniqueName: $sourceChannelUniqueName,
           discussionId: $discussionId
         })
         CREATE (recipient)-[:HAS_SCRATCHPAD_ENTRY]->(e)
         RETURN e.id AS id, toString(e.createdAt) AS createdAt, e.text AS text,
                e.isPublic AS isPublic, e.sourceType AS sourceType,
                e.sourceId AS sourceId,
                e.sourceChannelUniqueName AS sourceChannelUniqueName,
                e.discussionId AS discussionId`,
        {
          loggedInUsername,
          recipientUsername,
          text: text.trim(),
          sourceType,
          sourceId,
          sourceChannelUniqueName: sourceChannelUniqueName || postChannelUniqueName || null,
          discussionId: postDiscussionId || null,
        }
      );

      const entryRecord = createEntryResult.records[0];
      if (!entryRecord) {
        throw new Error('Failed to create scratchpad entry');
      }
      const entryId = entryRecord.get('id');

      // 4. Create the SUPER_UPVOTED relationship and bump weightedVotesCount.
      //    A super upvote is a second vote, so it adds the same +1 weight as a
      //    normal upvote (the recipient already has the normal upvote's weight).
      if (sourceType === 'comment') {
        await tx.run(
          `MATCH (c:Comment { id: $sourceId }), (u:User { username: $username })
           CREATE (u)-[:SUPER_UPVOTED_COMMENT]->(c)
           SET c.weightedVotesCount = coalesce(c.weightedVotesCount, 0) + 1`,
          { sourceId, username: loggedInUsername }
        );
      } else {
        await tx.run(
          `MATCH (dc:DiscussionChannel { id: $sourceId }), (u:User { username: $username })
           CREATE (u)-[:SUPER_UPVOTED_DISCUSSION]->(dc)
           SET dc.weightedVotesCount = coalesce(dc.weightedVotesCount, 0) + 1`,
          { sourceId, username: loggedInUsername }
        );
      }

      // 5. Award karma to the content author, like a normal upvote does (a super
      //    upvote is a second vote, so it grants a second karma point).
      if (postAuthorUsername) {
        const karmaField = sourceType === 'comment' ? 'commentKarma' : 'discussionKarma';
        await tx.run(
          `MATCH (a:User { username: $postAuthorUsername })
           SET a.${karmaField} = coalesce(a.${karmaField}, 0) + 1`,
          { postAuthorUsername }
        );
      }

      // 6. Notify the recipient. Link to the upvoted content (the specific
      //    comment if a comment was super upvoted, otherwise the discussion) and
      //    to their Kudos page, and connect the notification to the scratchpad
      //    entry so they can show-on-profile / ignore it from the bell.
      const truncatedText = text.length > 50 ? text.substring(0, 50) + '...' : text;
      const subject = sourceType === 'comment' ? 'comment' : 'post';
      const kudosUrl = `/u/${recipientUsername}/scratchpad`;
      let postUrl = kudosUrl;
      if (postDiscussionId && postChannelUniqueName) {
        postUrl =
          sourceType === 'comment'
            ? `/forums/${postChannelUniqueName}/discussions/${postDiscussionId}/comments/${sourceId}`
            : `/forums/${postChannelUniqueName}/discussions/${postDiscussionId}`;
      }
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
          entryId,
          notificationText,
        }
      );

      // 7. Read the updated super-upvoter list inside the same transaction so it
      //    always reflects the relationship we just created. A post-commit read
      //    on a fresh OGM session can lag behind the write on a clustered
      //    database, returning a stale list that omits the actor — which left the
      //    frontend super-upvote button looking inactive (and un-undoable).
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
        id: entryId,
        createdAt: entryRecord.get('createdAt'),
        text: entryRecord.get('text'),
        isPublic: entryRecord.get('isPublic'),
        sourceType: entryRecord.get('sourceType'),
        sourceId: entryRecord.get('sourceId'),
        sourceChannelUniqueName: entryRecord.get('sourceChannelUniqueName'),
        discussionId: entryRecord.get('discussionId'),
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
