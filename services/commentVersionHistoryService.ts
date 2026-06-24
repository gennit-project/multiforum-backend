import { execute, parse, subscribe } from 'graphql';
import { trackTextVersion, type OGMLike } from './textVersionHistory.js';

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
  ogm: OGMLike,
  commentId: string
): Promise<string | null> => {
  const CommentModel = ogm.model('Comment');
  const comments = await CommentModel.find({
    where: { id: commentId },
    selectionSet: `{
      id
      CommentAuthor {
        ... on User { username }
        ... on ModerationProfile { displayName }
      }
    }`,
  });
  if (!comments.length) {
    return null;
  }
  const author = comments[0].CommentAuthor;
  return author?.username || author?.displayName || null;
};

/**
 * Track a comment's text change by saving the PREVIOUS text as a TextVersion
 * connected to PastVersions (so the edit history preserves what was replaced).
 */
export const trackCommentTextVersion = (
  ogm: OGMLike,
  commentId: string,
  previousText: string,
  username: string
): Promise<string | null> =>
  trackTextVersion(ogm, {
    body: previousText,
    username,
    parentModelName: 'Comment',
    parentId: commentId,
    relationshipField: 'PastVersions',
  });

/**
 * Handle a single comment update event: resolve the author, then save the
 * previous text as a version. Callable core of the subscription handler,
 * extracted so it can be tested directly.
 */
export const handleCommentUpdateEvent = async (
  ogm: OGMLike,
  updatedComment: CommentUpdatePayload,
  previousValues: CommentPreviousValues | null | undefined
): Promise<void> => {
  const previousText = previousValues?.text;
  if (!previousText || previousText === updatedComment.text) {
    // Nothing meaningful changed; no version to record.
    return;
  }

  const username = await getCommentAuthorUsername(ogm, updatedComment.id);
  if (!username) {
    console.log('Could not determine username from comment author');
    return;
  }

  await trackCommentTextVersion(ogm, updatedComment.id, previousText, username);
};

/**
 * Comment Version History Service that listens to Comment update events
 * and tracks version history of text changes
 */
export class CommentVersionHistoryService {
  private schema: any;
  private ogm: any;
  private isRunning: boolean = false;
  private subscriptionIterator: AsyncIterableIterator<any> | null = null;

  constructor(schema: any, ogm: any) {
    this.schema = schema;
    this.ogm = ogm;
    console.log('Comment version history service initialized');
  }

  /**
   * Start listening for comment update events
   */
  async start() {
    if (this.isRunning) {
      console.log('Comment version history service is already running');
      return;
    }

    try {
      console.log('Starting comment version history service...');
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
        contextValue: { ogm: this.ogm }
      });

      // Check if result is an AsyncIterator (subscription succeeded)
      if (Symbol.asyncIterator in result) {
        this.subscriptionIterator = result as AsyncIterableIterator<any>;

        // Start processing comment update events
        this.processCommentUpdateEvents();
        console.log('Comment version history service started');
      } else {
        // If not an AsyncIterator, it's an error result
        console.error('Subscription failed:', result);
        this.isRunning = false;
      }
    } catch (error) {
      console.error('Error starting comment version history service:', error);
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
          console.log('Received invalid comment update event:', result);
          continue;
        }

        const updatedComment = result.data.commentUpdated.updatedComment;
        const previousValues = result.data.commentUpdated.previousValues;

        console.log('Processing version history for updated comment:', updatedComment.id);

        try {
          await handleCommentUpdateEvent(this.ogm, updatedComment, previousValues);
        } catch (error) {
          console.error('Error processing comment version history:', error);
          // Continue processing other events even if one fails
        }
      }
    } catch (error) {
      console.error('Error in comment update event processing:', error);
      
      // If the subscription fails, wait and restart
      if (this.isRunning) {
        console.log('Restarting comment version history service in 5 seconds...');
        setTimeout(() => this.start(), 5000);
      }
    }
  }

  /**
   * Stop the comment version history service
   */
  stop() {
    console.log('Stopping comment version history service');
    this.isRunning = false;

    // Clear the subscription iterator
    this.subscriptionIterator = null;
  }
}