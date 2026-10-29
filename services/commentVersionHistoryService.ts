import { parse, subscribe } from 'graphql';
import { trackTextVersion } from './textVersionHistory.js';
import type { VersionHistoryRepository } from './persistence/versionHistoryRepository.js';
import { logger } from "../logger.js";
import type { GraphQLSchema, ExecutionResult } from "graphql";
import { SubscriptionConsumer } from './subscriptionConsumer.js';

export interface CommentUpdatePayload {
  id: string;
  text?: string | null;
}

export interface CommentPreviousValues {
  text?: string | null;
}

/**
 * Look up the username of a comment's author. The author may be a User
 * (username) or a ModerationProfile (displayName). Returns null if the comment
 * or its author cannot be found.
 */
export const getCommentAuthorUsername = async (
  repository: VersionHistoryRepository,
  commentId: string
): Promise<string | null> => {
  try {
    return await repository.getCommentAuthorName(commentId);
  } catch (error) {
    logger.error('Error getting comment author name:', error);
    return null;
  }
};

/**
 * Track a comment's text change by saving the PREVIOUS text as a TextVersion
 * connected to PastVersions (so the edit history preserves what was replaced).
 */
export const trackCommentTextVersion = (
  repository: VersionHistoryRepository,
  commentId: string,
  previousText: string,
  username: string
): Promise<string | null> =>
  trackTextVersion(repository, {
    target: 'comment',
    body: previousText,
    username,
    parentId: commentId,
  });

/**
 * Handle a single comment update event: resolve the author, then save the
 * previous text as a version. Callable core of the subscription handler,
 * extracted so it can be tested directly.
 */
export const handleCommentUpdateEvent = async (
  repository: VersionHistoryRepository,
  updatedComment: CommentUpdatePayload,
  previousValues: CommentPreviousValues | null | undefined
): Promise<void> => {
  const previousText = previousValues?.text;
  if (!previousText || previousText === updatedComment.text) {
    // Nothing meaningful changed; no version to record.
    return;
  }

  const username = await getCommentAuthorUsername(repository, updatedComment.id);
  if (!username) {
    logger.info('Could not determine username from comment author');
    return;
  }

  await trackCommentTextVersion(repository, updatedComment.id, previousText, username);
};

/**
 * Comment Version History Service that listens to Comment update events
 * and tracks version history of text changes
 */
export class CommentVersionHistoryService {
  private schema: GraphQLSchema;
  private repository: VersionHistoryRepository;
  private consumer: SubscriptionConsumer;

  constructor(schema: GraphQLSchema, repository: VersionHistoryRepository) {
    this.schema = schema;
    this.repository = repository;
    this.consumer = new SubscriptionConsumer('commentVersionHistory', () => this.subscribe(), (result) => this.processEvent(result));
    logger.info('Comment version history service initialized');
  }

  /**
   * Start listening for comment update events
   */
  start(): Promise<void> {
    return this.consumer.start();
  }

  private async subscribe() {
    const commentSubscription = `
      subscription {
        commentUpdated {
          updatedComment {
            id
            text
            updatedAt
            CommentAuthor {
              ... on User {
                username
              }
              ... on ModerationProfile {
                displayName
              }
            }
          }
          previousValues {
            text
          }
        }
      }
    `;

    // Subscribe to comment update events
    return subscribe({
      schema: this.schema,
      document: parse(commentSubscription),
    });

  }

  private async processEvent(result: ExecutionResult): Promise<void> {
    const event = result.data?.commentUpdated as { updatedComment: CommentUpdatePayload; previousValues?: CommentPreviousValues | null } | undefined;
    if (!event) {
      logger.info('Received invalid comment update event:');
      return;
    }

    const updatedComment = event.updatedComment;
    const previousValues = event.previousValues;

    logger.info('Processing version history for updated comment:', updatedComment.id);

    try {
      await handleCommentUpdateEvent(this.repository, updatedComment, previousValues);
    } catch (error) {
      logger.error('Error processing comment version history:', error);
      // Continue processing other events even if one fails
    }
  }

  stop(): Promise<void> {
    return this.consumer.stop();
  }
}
