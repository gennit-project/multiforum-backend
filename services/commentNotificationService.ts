import { execute, parse, subscribe } from 'graphql';
import { 
  sendEmailToUser, 
  createCommentNotificationEmail, 
  createEventCommentNotificationEmail,
  createCommentReplyNotificationEmail 
} from '../customResolvers/mutations/shared/emailUtils.js';
import { sendBatchEmails } from './mail/index.js';

type AsyncIterableIterator<T> = AsyncIterable<T> & AsyncIterator<T>;

/**
 * Comment notification service that listens to Comment creation events
 * and sends notifications to relevant users
 */
export class CommentNotificationService {
  private schema: any;
  private ogm: any;
  private driver: any;
  private isRunning: boolean = false;
  private subscriptionIterator: AsyncIterableIterator<any> | null = null;

  constructor(schema: any, ogm: any, driver?: any) {
    this.schema = schema;
    this.ogm = ogm;
    this.driver = driver;
    console.log('Comment notification service initialized');
  }

  /**
   * Start listening for comment creation events
   */
  async start() {
    if (this.isRunning) {
      console.log('Comment notification service is already running');
      return;
    }

    try {
      console.log('Starting comment notification service...');
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
        console.log('=== DEBUG: Comment notification service started successfully');
      } else {
        // If not an AsyncIterator, it's an error result
        console.error('=== DEBUG ERROR: Subscription failed:', result);
        this.isRunning = false;
      }
    } catch (error) {
      console.error('Error starting comment notification service:', error);
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
          console.log('Received invalid comment event:', result);
          continue;
        }

        const commentBasicInfo = result.data.commentCreated.createdComment;
        const commentId = commentBasicInfo.id;
        
        console.log('Processing notification for newly created comment:', commentId);

        try {
          // Fetch the full comment details
          await this.processCommentNotification(commentId);
        } catch (error) {
          console.error('Error processing comment notification:', error);
          // Continue processing other events even if one fails
        }
      }
    } catch (error) {
      console.error('Error in comment event processing:', error);
      
      // If the subscription fails, wait and restart
      if (this.isRunning) {
        console.log('Restarting comment notification service in 5 seconds...');
        setTimeout(() => this.start(), 5000);
      }
    }
  }

  /**
   * Process a notification for a newly created comment
   */
  private async processCommentNotification(commentId: string) {
    console.log('=== DEBUG: Starting processCommentNotification for comment:', commentId);
    
    // Get the OGM models
    const CommentModel = this.ogm.model('Comment');
    const UserModel = this.ogm.model('User');
    const DiscussionModel = this.ogm.model('Discussion');

    // Fetch the full comment details with a more comprehensive selection
    const fullComments = await CommentModel.find({
      where: { id: commentId },
      selectionSet: `{
        id
        text
        isRootComment
        Channel {
          uniqueName
        }
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
        DiscussionChannel {
          id
          discussionId
          channelUniqueName
          Channel {
            uniqueName
            displayName
          }
          Discussion {
            id
            title
            Author {
              username
            }
          }
          SubscribedToNotifications {
            username
          }
        }
        Event {
          id
          title
          Poster {
            username
          }
          EventChannels {
            channelUniqueName
            Channel {
              uniqueName
            }
          }
          SubscribedToNotifications {
            username
          }
        }
        ParentComment {
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
          SubscribedToNotifications {
            username
          }
        }
      }`
    });

    if (!fullComments || !fullComments.length) {
      console.error('=== DEBUG ERROR: Could not find comment details for ID:', commentId);
      return;
    }

    const fullComment = fullComments[0];
    console.log('=== DEBUG: Found comment details for ID:', commentId);
    console.log('=== DEBUG: Comment structure:', {
      hasDiscussionChannel: !!fullComment.DiscussionChannel,
      hasEvent: !!fullComment.Event,
      hasParentComment: !!fullComment.ParentComment,
      discussionChannelId: fullComment.DiscussionChannel?.id,
      eventId: fullComment.Event?.id,
      parentCommentId: fullComment.ParentComment?.id,
      channelName: fullComment.Channel?.uniqueName
    });

    // Get the commenter info
    const commenterUsername =
      fullComment.CommentAuthor?.username ||
      fullComment.CommentAuthor?.displayName ||
      'Someone';

    console.log('Processing notification for comment type:');
    console.log('- Has DiscussionChannel:', !!fullComment.DiscussionChannel);
    console.log('- Has Event:', !!fullComment.Event);
    console.log('- Has ParentComment:', !!fullComment.ParentComment);
    console.log('- Commenter username:', commenterUsername);

    // COMMENT REPLY NOTIFICATION
    // Check for replies first, as a reply can also have a DiscussionChannel or Event
    if (fullComment.ParentComment) {
      console.log('This is a REPLY to another comment');
      await this.processCommentReplyNotification(
        fullComment,
        commentId,
        commenterUsername,
        CommentModel,
        UserModel
      );
    }
    // DISCUSSION COMMENT NOTIFICATION
    else if (fullComment.DiscussionChannel) {
      console.log('=== DEBUG: This is a comment on a DISCUSSION');
      console.log('=== DEBUG: DiscussionChannel details:', {
        id: fullComment.DiscussionChannel.id,
        discussionId: fullComment.DiscussionChannel.discussionId,
        channelUniqueName: fullComment.DiscussionChannel.channelUniqueName,
        subscribedUsersCount: fullComment.DiscussionChannel.SubscribedToNotifications?.length || 0,
        subscribedUsers: fullComment.DiscussionChannel.SubscribedToNotifications?.map((u: any) => u.username) || []
      });
      await this.processDiscussionCommentNotification(
        fullComment,
        commentId,
        commenterUsername,
        DiscussionModel,
        UserModel
      );
    }
    // EVENT COMMENT NOTIFICATION
    else if (fullComment.Event) {
      console.log('This is a comment on an EVENT');
      await this.processEventCommentNotification(
        fullComment,
        commentId,
        commenterUsername,
        UserModel
      );
    }
  }

  /**
   * Create batch notifications and send emails for subscribed users using Cypher
   */
  private async createBatchNotifications(
    driver: any,
    notificationText: string,
    commenterUsername: string,
    entityType: 'DiscussionChannel' | 'Event' | 'Comment',
    entityId: string,
    emailContent?: { subject: string; plainText: string; html: string }
  ) {
    console.log('=== DEBUG: Starting createBatchNotifications');
    console.log('=== DEBUG: Parameters:', {
      entityType,
      entityId,
      commenterUsername,
      notificationTextLength: notificationText.length
    });
    
    const session = driver.session();
    
    try {
      // First, let's check what subscriptions exist using OGM to get email addresses
      console.log('=== DEBUG: Fetching subscribed users with emails using OGM');
      
      // Get the entity model based on entityType
      const EntityModel = this.ogm.model(entityType);
      
      // Fetch the entity with its subscribed users and their emails
      const entityResults = await EntityModel.find({
        where: { id: entityId },
        selectionSet: `{
          id
          SubscribedToNotifications {
            username
            Email {
              address
            }
          }
        }`
      });
      
      if (!entityResults || !entityResults.length) {
        console.error('=== DEBUG ERROR: Entity not found:', { entityType, entityId });
        return 0;
      }
      
      const entity = entityResults[0];
      const subscribedUsersData = entity.SubscribedToNotifications?.map((user: any) => ({
        username: user.username,
        email: user.Email?.address || null
      })) || [];
      
      console.log('=== DEBUG: Found subscribed users with emails:', subscribedUsersData);
      console.log('=== DEBUG: Total subscribed users count:', subscribedUsersData.length);
      
      // Filter out the commenter
      const usersToNotify = subscribedUsersData.filter((userData: any) => userData.username !== commenterUsername);
      console.log('=== DEBUG: Users to notify (excluding commenter):', usersToNotify.map((u: any) => u.username));
      
      if (usersToNotify.length === 0) {
        console.log('=== DEBUG: No users to notify after filtering out commenter');
        return 0;
      }
      
      // Send batch emails if email content is provided
      if (emailContent) {
        await this.sendBatchEmails(usersToNotify, emailContent);
      }
      
      // Create notifications using Cypher (this part stays the same)
      const cypherQuery = `
        MATCH (entity:${entityType} {id: $entityId})
        MATCH (entity)<-[:SUBSCRIBED_TO_NOTIFICATIONS]-(user:User)
        WHERE user.username <> $commenterUsername
        CREATE (notification:Notification {
          id: randomUUID(),
          createdAt: datetime(),
          read: false,
          text: $notificationText
        })
        CREATE (user)-[:HAS_NOTIFICATION]->(notification)
        RETURN count(notification) as notificationsCreated, collect(user.username) as notifiedUsers
      `;

      console.log('=== DEBUG: Executing notification creation query:', cypherQuery);
      const result = await session.run(cypherQuery, {
        entityId,
        commenterUsername,
        notificationText
      });

      const notificationsCreated = result.records[0]?.get('notificationsCreated')?.toNumber() || 0;
      const notifiedUsers = result.records[0]?.get('notifiedUsers') || [];
      
      console.log('=== DEBUG: Notification creation results:', {
        notificationsCreated,
        notifiedUsers,
        entityType,
        entityId
      });
      
      if (notificationsCreated === 0) {
        console.log('=== DEBUG WARNING: No notifications were created');
      }
      
      return notificationsCreated;
    } catch (error) {
      console.error('=== DEBUG ERROR: Error in createBatchNotifications:', error);
      throw error;
    } finally {
      session.close();
    }
  }

  /**
   * Process notification for a comment on a discussion
   */
  private async processDiscussionCommentNotification(
    fullComment: any,
    commentId: string,
    commenterUsername: string,
    DiscussionModel: any,
    UserModel: any
  ) {
    console.log('=== DEBUG: Starting processDiscussionCommentNotification');
    console.log('=== DEBUG: Commenter username:', commenterUsername);

    const discussionChannel = fullComment.DiscussionChannel;
    if (!discussionChannel) {
      console.error('=== DEBUG ERROR: No discussion channel found');
      return;
    }
    
    console.log('=== DEBUG: DiscussionChannel ID:', discussionChannel.id);

    const discussion = discussionChannel.Discussion;
    if (!discussion) {
      console.error('=== DEBUG ERROR: Discussion not found in DiscussionChannel');
      return;
    }
    
    console.log('=== DEBUG: Discussion details:', {
      id: discussion.id,
      title: discussion.title,
      authorUsername: discussion.Author?.username
    });

    const channelName = fullComment.Channel?.uniqueName;
    
    // Create notification text for in-app notification
    const notificationText = `${commenterUsername} commented on the discussion [${discussion.title}](${process.env.FRONTEND_URL}/forums/${channelName}/discussions/${discussion.id}/comments/${commentId})`;

    // Create email content for discussion notification
    const emailContent = createCommentNotificationEmail(
      fullComment.text,
      discussion.title,
      commenterUsername,
      channelName || '',
      discussion.id,
      commentId
    );

    console.log('=== DEBUG: Creating batch notifications for discussion comment:', discussion.title);
    console.log('=== DEBUG: Notification text:', notificationText);

    // Use batch Cypher query to create notifications for all subscribed users
    if (this.driver) {
      console.log('=== DEBUG: Calling createBatchNotifications with:', {
        entityType: 'DiscussionChannel',
        entityId: discussionChannel.id,
        commenterUsername,
        driver: !!this.driver,
        hasEmailContent: !!emailContent
      });
      const notificationsCreated = await this.createBatchNotifications(
        this.driver,
        notificationText,
        commenterUsername,
        'DiscussionChannel',
        discussionChannel.id,
        emailContent
      );
      console.log('=== DEBUG: Batch notifications result:', notificationsCreated);
    } else {
      console.error('=== DEBUG ERROR: Driver not available for batch notifications');
    }
  }

  /**
   * Process notification for a comment on an event
   */
  private async processEventCommentNotification(
    fullComment: any,
    commentId: string,
    commenterUsername: string,
    UserModel: any
  ) {
    console.log('Processing comment on event');

    const event = fullComment.Event;
    if (!event) {
      console.log('Event not found');
      return;
    }

    const channelName = fullComment.Channel?.uniqueName;
    if (!channelName) {
      console.log('No channel found for event');
      return;
    }

    // Create notification text for in-app notification
    const notificationText = `${commenterUsername} commented on the event [${event.title}](${process.env.FRONTEND_URL}/forums/${channelName}/events/${event.id}/comments/${commentId})`;

    // Create email content for event notification
    const emailContent = createEventCommentNotificationEmail(
      fullComment.text,
      event.title,
      commenterUsername,
      channelName,
      event.id,
      commentId
    );

    console.log('=== DEBUG: Creating batch notifications for event comment:', event.title);

    // Use batch Cypher query to create notifications for all subscribed users
    if (this.driver) {
      await this.createBatchNotifications(
        this.driver,
        notificationText,
        commenterUsername,
        'Event',
        event.id,
        emailContent
      );
    } else {
      console.error('=== DEBUG ERROR: Driver not available for batch notifications');
    }
  }

  /**
   * Process notification for a reply to a comment
   */
  private async processCommentReplyNotification(
    fullComment: any,
    commentId: string,
    commenterUsername: string,
    CommentModel: any,
    UserModel: any
  ) {
    console.log('Processing reply to comment');

    const parentComment = fullComment.ParentComment;
    if (!parentComment) {
      console.log('Parent comment not found');
      return;
    }

    const parentCommentId = parentComment.id;
    console.log('Parent comment ID:', parentCommentId);

    // Determine content title and URL based on parent comment's context
    let contentTitle, contentUrl, channelName;

    // Check if the reply is on a discussion or event (from the current comment's context)
    if (fullComment.DiscussionChannel) {
      const discussion = fullComment.DiscussionChannel.Discussion;
      contentTitle = discussion?.title || 'a discussion';
      channelName = fullComment.Channel?.uniqueName;
      contentUrl = `${process.env.FRONTEND_URL}/forums/${channelName}/discussions/${discussion?.id}/comments/${parentCommentId}`;
    } else if (fullComment.Event) {
      const event = fullComment.Event;
      contentTitle = event?.title || 'an event';
      channelName = fullComment.Channel?.uniqueName;
      contentUrl = `${process.env.FRONTEND_URL}/forums/${channelName}/events/${event?.id}/comments/${parentCommentId}`;
    } else {
      console.log('No content reference found for comment reply');
      return;
    }

    // Create notification text for in-app notification
    const notificationText = `${commenterUsername} replied to your comment on [${contentTitle}](${contentUrl})`;

    // Create email content for reply notification
    const emailContent = createCommentReplyNotificationEmail(
      fullComment.text,
      contentTitle,
      commenterUsername,
      contentUrl
    );

    console.log('=== DEBUG: Creating batch notifications for comment reply on:', contentTitle);

    // Use batch Cypher query to create notifications for all users subscribed to the parent comment
    if (this.driver) {
      await this.createBatchNotifications(
        this.driver,
        notificationText,
        commenterUsername,
        'Comment',
        parentCommentId,
        emailContent
      );
    } else {
      console.error('=== DEBUG ERROR: Driver not available for batch notifications');
    }
  }

  /**
   * Send batch emails using SendGrid
   */
  private async sendBatchEmails(
    usersToNotify: Array<{ username: string; email: string | null }>,
    emailContent: { subject: string; plainText: string; html: string }
  ) {
    try {
      // Filter users who have email addresses
      const usersWithEmails = usersToNotify.filter(user => user.email);
      
      console.log('=== DEBUG: Users with emails to notify:', usersWithEmails.length);
      
      if (usersWithEmails.length === 0) {
        console.log('=== DEBUG: No users with email addresses to notify');
        return;
      }
      
      // Prepare batch email data
      const emailsToSend = usersWithEmails.map(user => ({
        to: user.email!,
        subject: emailContent.subject,
        text: emailContent.plainText,
        html: emailContent.html
      }));
      
      console.log('=== DEBUG: Sending batch emails to:', emailsToSend.map(email => email.to));
      
      // Send batch emails
      const emailSent = await sendBatchEmails(emailsToSend);

      if (!emailSent) {
        console.log('=== DEBUG: Batch email send skipped or failed');
        return;
      }
      
      console.log('=== DEBUG: Successfully sent', emailsToSend.length, 'batch emails');
      
    } catch (error) {
      console.error('=== DEBUG ERROR: Failed to send batch emails:', error);
      // Don't throw - continue with in-app notifications even if emails fail
    }
  }

  /**
   * Stop the comment notification service
   */
  stop() {
    console.log('Stopping comment notification service');
    this.isRunning = false;

    // Clear the subscription iterator
    this.subscriptionIterator = null;
  }
}
