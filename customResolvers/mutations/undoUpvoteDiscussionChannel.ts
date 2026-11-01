import type { GraphQLResolveInfo } from "graphql";
import type { Driver } from "neo4j-driver";
import { createDiscussionChannelVoteRepository, type DiscussionChannelVoteRepository } from "../../services/persistence/discussionChannelVoteRepository.js";
import type { GraphQLContext } from "../../types/context.js";
import {
  discussionChannelIsUpvotedByUserQuery,
} from "../cypher/cypherQueries.js";
import { getWeightedVoteBonus } from "./utils.js";
import { logger } from "../../logger.js";

type Input = {
  repository?: DiscussionChannelVoteRepository;
  driver: Driver;
};

type Args = {
  discussionChannelId: string;
  username: string;
};

const undoUpvoteDiscussionChannelResolver = (input: Input) => {
  const { driver } = input;
  const repository = input.repository ?? createDiscussionChannelVoteRepository(driver);

  return async (
    parent: unknown,
    args: Args,
    context: GraphQLContext,
    resolveInfo: GraphQLResolveInfo
  ) => {
    const { discussionChannelId, username } = args;

    if (!discussionChannelId || !username) {
      throw new Error(
        "All arguments (discussionChannelId, username) are required"
      );
    }

    const session = driver.session();

    const tx = session.beginTransaction();

    try {
      const result = await tx.run(discussionChannelIsUpvotedByUserQuery, {
        username,
        discussionChannelId,
      });
      const singleRecord = result.records[0];
      const upvotedByUser = singleRecord.get("result").upvotedByUser;

      if (!upvotedByUser) {
        throw new Error(
          "Can't undo upvote because you haven't upvoted this discussion yet"
        );
      }
      // Fetch discussionChannel
      const discussionChannelResult = await repository.findDiscussionChannel(discussionChannelId);

      if (discussionChannelResult.length === 0) {
        throw new Error("DiscussionChannel not found");
      }

      const discussionChannel = discussionChannelResult[0];

      const postAuthorUsername = discussionChannel.Discussion?.Author?.username;
      const postAuthorKarma =
        discussionChannel.Discussion?.Author?.discussionKarma || 0;

      // Fetch data of the user who is upvoting the discussionChannel
      // because we need it to calculate the weighted vote bonus.
      const voterUserResult = await repository.findVoter(username);

      if (voterUserResult.length === 0) {
        throw new Error(
          "User data not found for the user who is undoing the upvote"
        );
      }

      const voterUser = voterUserResult[0];

      let weightedVoteBonus = getWeightedVoteBonus(voterUser);

      // Update weighted votes count on the discussionChannel and remove the relationship
      const undoUpvoteDiscussionChannelQuery = `
        MATCH (u:User { username: $username })-[r:UPVOTED_DISCUSSION]->(dc:DiscussionChannel { id: $discussionChannelId })
        SET dc.weightedVotesCount = coalesce(dc.weightedVotesCount, 0) - 1 - $weightedVoteBonus
        DELETE r
        RETURN dc
     `;

      await tx.run(undoUpvoteDiscussionChannelQuery, {
        discussionChannelId,
        username,
        weightedVoteBonus,
      });

      // Update the post author's karma
      if (postAuthorUsername) {
        await repository.setAuthorKarma(postAuthorUsername, postAuthorKarma - 1);
      }

      await tx.commit();

      const existingUpvotedByUsers = discussionChannel.UpvotedByUsers || [];
      const existingUpvotedByUsersCount = existingUpvotedByUsers.length;

      return {
        id: discussionChannelId,
        weightedVotesCount:
          (discussionChannel.weightedVotesCount ?? 0) - 1 - weightedVoteBonus,
        UpvotedByUsers: existingUpvotedByUsers.filter(
          (user) => user.username !== username
        ),
        UpvotedByUsersAggregate: {
          count: existingUpvotedByUsersCount - 1,
        },
        UpvotedByUsersConnection: {
          totalCount: existingUpvotedByUsersCount - 1,
          aggregate: { count: { nodes: existingUpvotedByUsersCount - 1 } },
        },
      };
    } catch (e) {
      if (tx) {
        try {
          await tx.rollback();
        } catch (rollbackError) {
          logger.error("Failed to rollback transaction", rollbackError);
        }
      }
      logger.error(e);
    } finally {
      if (session) {
        try {
          session.close();
        } catch (sessionCloseError) {
          logger.error("Failed to close session", sessionCloseError);
        }
      }
    }
  };
};

export default undoUpvoteDiscussionChannelResolver;
