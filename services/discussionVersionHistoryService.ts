import { parse, subscribe } from 'graphql';
import { trackTextVersion } from './textVersionHistory.js';
import type { VersionHistoryRepository } from './persistence/versionHistoryRepository.js';
import { logger } from "../logger.js";
import type { GraphQLSchema } from "graphql";

type AsyncIterableIterator<T> = AsyncIterable<T> & AsyncIterator<T>;

export interface DiscussionUpdatePayload {
  id: string;
  title?: string | null;
  body?: string | null;
}

export interface DiscussionPreviousValues {
  title?: string | null;
  body?: string | null;
}

/**
 * Look up the username of a discussion's current Author. Returns null if the
 * discussion or its author cannot be found.
 */
export const getDiscussionAuthorUsername = async (
  repository: VersionHistoryRepository,
  discussionId: string
): Promise<string | null> => {
  try {
    return await repository.getDiscussionAuthorUsername(discussionId);
  } catch (error) {
    logger.error('Error getting current user username:', error);
    return null;
  }
};

/**
 * Track a discussion's title change by saving the new title as a TextVersion
 * connected to PastTitleVersions.
 */
export const trackDiscussionTitleVersion = (
  repository: VersionHistoryRepository,
  discussionId: string,
  newTitle: string,
  username: string
): Promise<string | null> =>
  trackTextVersion(repository, {
    target: 'discussion-title',
    body: newTitle,
    username,
    parentId: discussionId,
  });

/**
 * Track a discussion's body change by saving the new body as a TextVersion
 * connected to PastBodyVersions.
 */
export const trackDiscussionBodyVersion = (
  repository: VersionHistoryRepository,
  discussionId: string,
  newBody: string,
  username: string
): Promise<string | null> =>
  trackTextVersion(repository, {
    target: 'discussion-body',
    body: newBody,
    username,
    parentId: discussionId,
  });

/**
 * Handle a single discussion update event: resolve the author, then record a
 * version for whichever of title/body actually changed. This is the callable
 * core of the subscription handler, extracted so it can be tested directly.
 */
export const handleDiscussionUpdateEvent = async (
  repository: VersionHistoryRepository,
  updatedDiscussion: DiscussionUpdatePayload,
  previousValues: DiscussionPreviousValues | null | undefined
): Promise<void> => {
  const discussionId = updatedDiscussion.id;
  const currentUsername = await getDiscussionAuthorUsername(repository, discussionId);
  if (!currentUsername) {
    logger.info('Could not determine current user, skipping version history');
    return;
  }

  if (
    previousValues?.title &&
    previousValues.title !== updatedDiscussion.title &&
    updatedDiscussion.title
  ) {
    await trackDiscussionTitleVersion(repository, discussionId, updatedDiscussion.title, currentUsername);
  }

  if (
    previousValues?.body &&
    previousValues.body !== updatedDiscussion.body &&
    updatedDiscussion.body
  ) {
    await trackDiscussionBodyVersion(repository, discussionId, updatedDiscussion.body, currentUsername);
  }
};

/**
 * Discussion Version History Service that listens to Discussion update events
 * and tracks version history of title and body changes
 */
export class DiscussionVersionHistoryService {
  private schema: GraphQLSchema;
  private repository: VersionHistoryRepository;
  private isRunning: boolean = false;
  private subscriptionIterator: AsyncIterableIterator<any> | null = null;

  constructor(schema: GraphQLSchema, repository: VersionHistoryRepository) {
    this.schema = schema;
    this.repository = repository;
    logger.info('Discussion version history service initialized');
  }

  /**
   * Start listening for discussion update events
   */
  async start() {
    if (this.isRunning) {
      logger.info('Discussion version history service is already running');
      return;
    }

    try {
      logger.info('Starting discussion version history service...');
      this.isRunning = true;

      // Define the subscription query to listen for discussion update events
      const discussionSubscription = `
        subscription {
          discussionUpdated {
            updatedDiscussion {
              id
              title
              body
              updatedAt
              Author {
                username
              }
            }
            previousValues {
              title
              body
            }
          }
        }
      `;

      // Subscribe to discussion update events
      const result = await subscribe({
        schema: this.schema,
        document: parse(discussionSubscription),
      });

      // Check if result is an AsyncIterator (subscription succeeded)
      if (Symbol.asyncIterator in result) {
        this.subscriptionIterator = result as AsyncIterableIterator<any>;

        // Start processing discussion update events
        this.processDiscussionUpdateEvents();
        logger.info('Discussion version history service started');
      } else {
        // If not an AsyncIterator, it's an error result
        logger.error('Subscription failed:', result);
        this.isRunning = false;
      }
    } catch (error) {
      logger.error('Error starting discussion version history service:', error);
      this.isRunning = false;
    }
  }

  /**
   * Process discussion update events and track version history
   */
  private async processDiscussionUpdateEvents() {
    if (!this.subscriptionIterator) return;

    try {
      // Process each discussion update event as it arrives
      for await (const result of this.subscriptionIterator) {
        if (!result.data?.discussionUpdated) {
          logger.info('Received invalid discussion update event:', result);
          continue;
        }

        const updatedDiscussion = result.data.discussionUpdated.updatedDiscussion;
        const previousValues = result.data.discussionUpdated.previousValues;

        logger.info('Processing version history for updated discussion:', updatedDiscussion.id);

        try {
          await handleDiscussionUpdateEvent(this.repository, updatedDiscussion, previousValues);
        } catch (error) {
          logger.error('Error processing discussion version history:', error);
          // Continue processing other events even if one fails
        }
      }
    } catch (error) {
      logger.error('Error in discussion update event processing:', error);
      
      // If the subscription fails, wait and restart
      if (this.isRunning) {
        logger.info('Restarting discussion version history service in 5 seconds...');
        setTimeout(() => this.start(), 5000);
      }
    }
  }

  /**
   * Stop the discussion version history service
   */
  stop() {
    logger.info('Stopping discussion version history service');
    this.isRunning = false;

    // Clear the subscription iterator
    this.subscriptionIterator = null;
  }
}
