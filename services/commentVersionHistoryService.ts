import { parse, subscribe } from 'graphql';
import { trackTextVersion } from './textVersionHistory.js';
import type { VersionHistoryRepository } from './persistence/versionHistoryRepository.js';
import { logger } from "../logger.js";
import type { GraphQLSchema } from "graphql";

type AsyncIterableIterator<T> = AsyncIterable<T> & AsyncIterator<T>;

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
  private isRunning: boolean = false;
  private subscriptionIterator: AsyncIterableIterator<any> | null = null;

  constructor(schema: GraphQLSchema, repository: VersionHistoryRepository) {
    this.schema = schema;
    this.repository = repository;
    logger.info('Comment version history service initialized');
  }

  /**
   * Start listening for comment update events
   */
  async start() {
    if (this.isRunning) {
      logger.info('Comment version history service is already running');
      return;
    }

    try {
      logger.info('Starting comment version history service...');
      this.isRunning = true;

      // Define the subscription query to listen for comment update events
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
      const result = await subscribe({
        schema: this.schema,
        document: parse(commentSubscription),
      });

      // Check if result is an AsyncIterator (subscription succeeded)
      if (Symbol.asyncIterator in result) {
        this.subscriptionIterator = result as AsyncIterableIterator<any>;

        // Start processing comment update events
        this.processCommentUpdateEvents();
        logger.info('Comment version history service started');
      } else {
        // If not an AsyncIterator, it's an error result
        logger.error('Subscription failed:', result);
        this.isRunning = false;
      }
    } catch (error) {
      logger.error('Error starting comment version history service:', error);
      this.isRunning = false;
    }
  }

  /**
   * Process comment update events and track version history
   */
  private async processCommentUpdateEvents() {
    if (!this.subscriptionIterator) return;

    try {
      // Process each comment update event as it arrives
      for await (const result of this.subscriptionIterator) {
        if (!result.data?.commentUpdated) {
          logger.info('Received invalid comment update event:', result);
          continue;
        }

        const updatedComment = result.data.commentUpdated.updatedComment;
        const previousValues = result.data.commentUpdated.previousValues;

        logger.info('Processing version history for updated comment:', updatedComment.id);

        try {
          await handleCommentUpdateEvent(this.repository, updatedComment, previousValues);
        } catch (error) {
          logger.error('Error processing comment version history:', error);
          // Continue processing other events even if one fails
        }
      }
    } catch (error) {
      logger.error('Error in comment update event processing:', error);
      
      // If the subscription fails, wait and restart
      if (this.isRunning) {
        logger.info('Restarting comment version history service in 5 seconds...');
        setTimeout(() => this.start(), 5000);
      }
    }
  }

  /**
   * Stop the comment version history service
   */
  stop() {
    logger.info('Stopping comment version history service');
    this.isRunning = false;

    // Clear the subscription iterator
    this.subscriptionIterator = null;
  }
}
