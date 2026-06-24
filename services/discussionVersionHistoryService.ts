import { execute, parse, subscribe } from 'graphql';
import { trackTextVersion, type OGMLike } from './textVersionHistory.js';
import { logger } from "../logger.js";

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
  ogm: OGMLike,
  discussionId: string
): Promise<string | null> => {
  try {
    const DiscussionModel = ogm.model('Discussion');
    const discussions = await DiscussionModel.find({
      where: { id: discussionId },
      selectionSet: `{ Author { username } }`,
    });
    if (!discussions.length || !discussions[0].Author?.username) {
      return null;
    }
    return discussions[0].Author.username;
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
  ogm: OGMLike,
  discussionId: string,
  newTitle: string,
  username: string
): Promise<string | null> =>
  trackTextVersion(ogm, {
    body: newTitle,
    username,
    parentModelName: 'Discussion',
    parentId: discussionId,
    relationshipField: 'PastTitleVersions',
  });

/**
 * Track a discussion's body change by saving the new body as a TextVersion
 * connected to PastBodyVersions.
 */
export const trackDiscussionBodyVersion = (
  ogm: OGMLike,
  discussionId: string,
  newBody: string,
  username: string
): Promise<string | null> =>
  trackTextVersion(ogm, {
    body: newBody,
    username,
    parentModelName: 'Discussion',
    parentId: discussionId,
    relationshipField: 'PastBodyVersions',
  });

/**
 * Handle a single discussion update event: resolve the author, then record a
 * version for whichever of title/body actually changed. This is the callable
 * core of the subscription handler, extracted so it can be tested directly.
 */
export const handleDiscussionUpdateEvent = async (
  ogm: OGMLike,
  updatedDiscussion: DiscussionUpdatePayload,
  previousValues: DiscussionPreviousValues | null | undefined
): Promise<void> => {
  const discussionId = updatedDiscussion.id;
  const currentUsername = await getDiscussionAuthorUsername(ogm, discussionId);
  if (!currentUsername) {
    logger.info('Could not determine current user, skipping version history');
    return;
  }

  if (
    previousValues?.title &&
    previousValues.title !== updatedDiscussion.title &&
    updatedDiscussion.title
  ) {
    await trackDiscussionTitleVersion(ogm, discussionId, updatedDiscussion.title, currentUsername);
  }

  if (
    previousValues?.body &&
    previousValues.body !== updatedDiscussion.body &&
    updatedDiscussion.body
  ) {
    await trackDiscussionBodyVersion(ogm, discussionId, updatedDiscussion.body, currentUsername);
  }
};

/**
 * Discussion Version History Service that listens to Discussion update events
 * and tracks version history of title and body changes
 */
export class DiscussionVersionHistoryService {
  private schema: any;
  private ogm: any;
  private isRunning: boolean = false;
  private subscriptionIterator: AsyncIterableIterator<any> | null = null;

  constructor(schema: any, ogm: any) {
    this.schema = schema;
    this.ogm = ogm;
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
        contextValue: { ogm: this.ogm }
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
          await handleDiscussionUpdateEvent(this.ogm, updatedDiscussion, previousValues);
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