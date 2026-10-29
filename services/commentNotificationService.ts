import type { NotificationSnapshotRepository } from "./persistence/notificationSnapshotRepository.js";
import { parse, subscribe } from 'graphql';
import { handleCommentCreatedNotification } from './commentNotificationHandler.js';
import { logger } from "../logger.js";
import type { GraphQLSchema, ExecutionResult } from "graphql";
import type { Driver } from "neo4j-driver";
import { SubscriptionConsumer } from './subscriptionConsumer.js';

/**
 * Comment notification service that listens to Comment creation events
 * and sends notifications to relevant users
 */
export class CommentNotificationService {
  private schema: GraphQLSchema;
  private driver?: Driver;
  private consumer: SubscriptionConsumer;

  constructor(schema: GraphQLSchema, driver?: Driver, private notificationSnapshotRepository?: NotificationSnapshotRepository) {
    this.schema = schema;
    this.driver = driver;
    this.consumer = new SubscriptionConsumer('commentNotification', () => this.subscribe(), (result) => this.processEvent(result));
    logger.info('Comment notification service initialized');
  }

  /**
   * Start listening for comment creation events
   */
  start(): Promise<void> {
    return this.consumer.start();
  }

  private async subscribe() {
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
    return subscribe({
      schema: this.schema,
      document: parse(commentSubscription),
      contextValue: {}
    });

  }

  private async processEvent(result: ExecutionResult): Promise<void> {
    const event = result.data?.commentCreated as { createdComment?: { id: string } } | undefined;
    if (!event?.createdComment) {
      logger.info('Received invalid comment event:');
      return;
    }

    const commentBasicInfo = event.createdComment;
    const commentId = commentBasicInfo.id;

    logger.info('Processing notification for newly created comment:', commentId);

    try {
      await handleCommentCreatedNotification(
        { driver: this.driver, notificationSnapshotRepository: this.notificationSnapshotRepository },
        commentId
      );
    } catch (error) {
      logger.error('Error processing comment notification:', error);
      // Continue processing other events even if one fails
    }
  }

  stop(): Promise<void> {
    return this.consumer.stop();
  }
}
