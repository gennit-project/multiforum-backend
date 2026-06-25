import { execute, parse, subscribe } from 'graphql';
import { handleCommentCreatedNotification } from './commentNotificationHandler.js';
import { logger } from "../logger.js";
import type { GraphQLSchema } from "graphql";
import type { Driver } from "neo4j-driver";
import type { Ogm } from "../types/context.js";

type AsyncIterableIterator<T> = AsyncIterable<T> & AsyncIterator<T>;

/**
 * Comment notification service that listens to Comment creation events
 * and sends notifications to relevant users
 */
export class CommentNotificationService {
  private schema: GraphQLSchema;
  private ogm: Ogm;
  private driver?: Driver;
  private isRunning: boolean = false;
  private subscriptionIterator: AsyncIterableIterator<any> | null = null;

  constructor(schema: GraphQLSchema, ogm: Ogm, driver?: Driver) {
    this.schema = schema;
    this.ogm = ogm;
    this.driver = driver;
    logger.info('Comment notification service initialized');
  }

  /**
   * Start listening for comment creation events
   */
  async start() {
    if (this.isRunning) {
      logger.info('Comment notification service is already running');
      return;
    }

    try {
      logger.info('Starting comment notification service...');
      this.isRunning = true;

      // Define the subscription query to listen for comment creation events
      const commentSubscription = `
        subscription {
          commentCreated {
            createdComment {
              id
              text
              CommentAuthor {
                ... on User {
                  __typename
                  username
                }
                ... on ModerationProfile {
                  __typename
                  displayName
                }
              }
            }
          }
        }
      `;

      // Subscribe to comment creation events
      const result = await subscribe({
        schema: this.schema,
        document: parse(commentSubscription),
        contextValue: { ogm: this.ogm }
      });

      // Check if result is an AsyncIterator (subscription succeeded)
      if (Symbol.asyncIterator in result) {
        this.subscriptionIterator = result as AsyncIterableIterator<any>;

        // Start processing comment events
        this.processCommentEvents();
        logger.info('=== DEBUG: Comment notification service started successfully');
      } else {
        // If not an AsyncIterator, it's an error result
        logger.error('=== DEBUG ERROR: Subscription failed:', result);
        this.isRunning = false;
      }
    } catch (error) {
      logger.error('Error starting comment notification service:', error);
      this.isRunning = false;
    }
  }

  /**
   * Process comment creation events and send notifications
   */
  private async processCommentEvents() {
    if (!this.subscriptionIterator) return;

    try {
      // Process each comment event as it arrives
      for await (const result of this.subscriptionIterator) {
        if (!result.data?.commentCreated?.createdComment) {
          logger.info('Received invalid comment event:', result);
          continue;
        }

        const commentBasicInfo = result.data.commentCreated.createdComment;
        const commentId = commentBasicInfo.id;

        logger.info('Processing notification for newly created comment:', commentId);

        try {
          await handleCommentCreatedNotification(
            { ogm: this.ogm, driver: this.driver },
            commentId
          );
        } catch (error) {
          logger.error('Error processing comment notification:', error);
          // Continue processing other events even if one fails
        }
      }
    } catch (error) {
      logger.error('Error in comment event processing:', error);
      
      // If the subscription fails, wait and restart
      if (this.isRunning) {
        logger.info('Restarting comment notification service in 5 seconds...');
        setTimeout(() => this.start(), 5000);
      }
    }
  }

  /**
   * Stop the comment notification service
   */
  stop() {
    logger.info('Stopping comment notification service');
    this.isRunning = false;

    // Clear the subscription iterator
    this.subscriptionIterator = null;
  }
}
