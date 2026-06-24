// Callable core of the comment-notification service, extracted from the
// subscription class so the whole pipeline can be exercised directly against a
// live database. The class (commentNotificationService.ts) now only owns the
// subscription plumbing (start/stop/restart) and delegates each created-comment
// event to handleCommentCreatedNotification() here.
//
// All DB access goes through the injected deps ({ ogm, driver }); email sending
// goes through services/mail, which no-ops when no provider is configured (so
// tests never send real mail).

import {
  createCommentNotificationEmail,
  createEventCommentNotificationEmail,
  createCommentReplyNotificationEmail,
} from "../customResolvers/mutations/shared/emailUtils.js";
import { sendBatchEmails } from "./mail/index.js";
import {
  resolveReplyNotificationRecipients,
  type NotificationRecipient,
} from "./commentNotificationRecipients.js";
import { notifyFeedback } from "../hooks/feedbackNotificationHook.js";
import { notifyModMentions } from "../hooks/modMentionNotificationHook.js";
import { notifyCommentMentions } from "../hooks/userMentionNotificationHook.js";
import { appendNotificationFooter } from "../utils/notificationFooter.js";
import { logger } from "../logger.js";

export interface NotificationDeps {
  ogm: any;
  driver: any;
}

export interface EmailContent {
  subject: string;
  plainText: string;
  html: string;
}

// Selection set used to load everything the notification pipeline needs about a
// newly created comment. Kept as a constant so the handler and tests agree on
// what shape `fullComment` has.
export const FULL_COMMENT_SELECTION_SET = `{
  id
  text
  isRootComment
  isFeedbackComment
  Channel {
    uniqueName
  }
  CommentAuthor {
    ... on User {
      __typename
      username
      displayName
    }
    ... on ModerationProfile {
      __typename
      displayName
      User {
        username
      }
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
  GivesFeedbackOnComment {
    id
    CommentAuthor {
      ... on User {
        username
      }
      ... on ModerationProfile {
        User {
          username
        }
      }
    }
  }
  GivesFeedbackOnDiscussion {
    id
    Author {
      username
    }
  }
  GivesFeedbackOnEvent {
    id
    Poster {
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
        notifyOnReplyToCommentByDefault
        Email {
          address
        }
      }
      ... on ModerationProfile {
        __typename
        displayName
        User {
          username
          notifyOnReplyToCommentByDefault
          Email {
            address
          }
        }
      }
    }
    SubscribedToNotifications {
      username
      Email {
        address
      }
    }
  }
}`;

/**
 * Send batch emails to the recipients that have an email address. Failures are
 * swallowed so in-app notifications still proceed.
 */
export const sendNotificationEmails = async (
  usersToNotify: NotificationRecipient[],
  emailContent: EmailContent
): Promise<void> => {
  try {
    const usersWithEmails = usersToNotify.filter((user) => user.email);
    if (usersWithEmails.length === 0) {
      return;
    }

    const emailsToSend = usersWithEmails.map((user) => ({
      to: user.email!,
      subject: emailContent.subject,
      text: emailContent.plainText,
      html: emailContent.html,
    }));

    await sendBatchEmails(emailsToSend);
  } catch (error) {
    logger.error("Failed to send notification emails:", error);
    // Don't throw - continue with in-app notifications even if emails fail.
  }
};

/**
 * Create Notification nodes for every user subscribed to an entity (excluding
 * the commenter), and send them emails. Returns the number created.
 */
export const createBatchNotifications = async (
  deps: NotificationDeps,
  notificationText: string,
  commenterUsername: string,
  entityType: "DiscussionChannel" | "Event" | "Comment",
  entityId: string,
  emailContent?: EmailContent,
  notificationType: string = "reply"
): Promise<number> => {
  const session = deps.driver.session();

  try {
    const EntityModel = deps.ogm.model(entityType);
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
      }`,
    });

    if (!entityResults || !entityResults.length) {
      logger.error("Entity not found for notifications:", { entityType, entityId });
      return 0;
    }

    const entity = entityResults[0];
    const subscribedUsersData =
      entity.SubscribedToNotifications?.map((user: any) => ({
        username: user.username,
        email: user.Email?.address || null,
      })) || [];

    const usersToNotify = subscribedUsersData.filter(
      (userData: any) => userData.username !== commenterUsername
    );

    if (usersToNotify.length === 0) {
      return 0;
    }

    if (emailContent) {
      await sendNotificationEmails(usersToNotify, emailContent);
    }

    const cypherQuery = `
      MATCH (entity:${entityType} {id: $entityId})
      MATCH (entity)<-[:SUBSCRIBED_TO_NOTIFICATIONS]-(user:User)
      WHERE user.username <> $commenterUsername
      CREATE (notification:Notification {
        id: randomUUID(),
        createdAt: datetime(),
        read: false,
        text: $notificationText,
        notificationType: $notificationType
      })
      CREATE (user)-[:HAS_NOTIFICATION]->(notification)
      RETURN count(notification) as notificationsCreated, collect(user.username) as notifiedUsers
    `;

    const result = await session.run(cypherQuery, {
      entityId,
      commenterUsername,
      notificationText,
      notificationType,
    });

    return result.records[0]?.get("notificationsCreated")?.toNumber() || 0;
  } catch (error) {
    logger.error("Error in createBatchNotifications:", error);
    throw error;
  } finally {
    session.close();
  }
};

/**
 * Create Notification nodes for an explicit list of users (used by reply
 * notifications, where recipients are resolved from author preferences and
 * subscriptions rather than a single entity's subscriber list).
 */
export const createNotificationsForUsers = async (
  deps: NotificationDeps,
  usersToNotify: NotificationRecipient[],
  notificationText: string,
  emailContent?: EmailContent,
  notificationType: string = "reply"
): Promise<number> => {
  const session = deps.driver.session();

  try {
    if (emailContent) {
      await sendNotificationEmails(usersToNotify, emailContent);
    }

    const usernames = usersToNotify.map((user) => user.username);

    const result = await session.run(
      `
      UNWIND $usernames AS username
      MATCH (user:User {username: username})
      CREATE (notification:Notification {
        id: randomUUID(),
        createdAt: datetime(),
        read: false,
        text: $notificationText,
        notificationType: $notificationType
      })
      CREATE (user)-[:HAS_NOTIFICATION]->(notification)
      RETURN count(notification) as notificationsCreated, collect(user.username) as notifiedUsers
      `,
      { usernames, notificationText, notificationType }
    );

    return result.records[0]?.get("notificationsCreated")?.toNumber() || 0;
  } finally {
    session.close();
  }
};

/**
 * Notify users subscribed to a discussion that a new comment was posted.
 */
export const processDiscussionCommentNotification = async (
  deps: NotificationDeps,
  fullComment: any,
  commentId: string,
  commenterUsername: string
): Promise<void> => {
  const discussionChannel = fullComment.DiscussionChannel;
  if (!discussionChannel) {
    return;
  }

  const discussion = discussionChannel.Discussion;
  if (!discussion) {
    return;
  }

  const channelName = fullComment.Channel?.uniqueName;
  const discussionUrl = `${process.env.FRONTEND_URL}/forums/${channelName}/discussions/${discussion.id}`;

  const baseNotificationText = `${commenterUsername} commented on the discussion [${discussion.title}](${discussionUrl}/comments/${commentId})`;
  const notificationText = appendNotificationFooter(baseNotificationText, {
    contentType: "discussion",
    contentUrl: discussionUrl,
  });

  const emailContent = createCommentNotificationEmail(
    fullComment.text,
    discussion.title,
    commenterUsername,
    channelName || "",
    discussion.id,
    commentId
  );

  if (!deps.driver) {
    logger.error("Driver not available for batch notifications");
    return;
  }

  await createBatchNotifications(
    deps,
    notificationText,
    commenterUsername,
    "DiscussionChannel",
    discussionChannel.id,
    emailContent,
    "reply"
  );
};

/**
 * Notify users subscribed to an event that a new comment was posted.
 */
export const processEventCommentNotification = async (
  deps: NotificationDeps,
  fullComment: any,
  commentId: string,
  commenterUsername: string
): Promise<void> => {
  const event = fullComment.Event;
  if (!event) {
    return;
  }

  const channelName = fullComment.Channel?.uniqueName;
  if (!channelName) {
    return;
  }

  const eventUrl = `${process.env.FRONTEND_URL}/forums/${channelName}/events/${event.id}`;

  const baseNotificationText = `${commenterUsername} commented on the event [${event.title}](${eventUrl}/comments/${commentId})`;
  const notificationText = appendNotificationFooter(baseNotificationText, {
    contentType: "event",
    contentUrl: eventUrl,
  });

  const emailContent = createEventCommentNotificationEmail(
    fullComment.text,
    event.title,
    commenterUsername,
    channelName,
    event.id,
    commentId
  );

  if (!deps.driver) {
    logger.error("Driver not available for batch notifications");
    return;
  }

  await createBatchNotifications(
    deps,
    notificationText,
    commenterUsername,
    "Event",
    event.id,
    emailContent,
    "reply"
  );
};

/**
 * Notify the parent comment's author (and subscribers) that someone replied,
 * honoring the author's reply-notification preference.
 */
export const processCommentReplyNotification = async (
  deps: NotificationDeps,
  fullComment: any,
  commentId: string,
  commenterUsername: string
): Promise<void> => {
  const parentComment = fullComment.ParentComment;
  if (!parentComment) {
    return;
  }

  const parentCommentId = parentComment.id;

  let contentTitle: string;
  let contentUrl: string;
  let commentPermalinkUrl: string;
  let channelName: string | undefined;

  if (fullComment.DiscussionChannel) {
    const discussion = fullComment.DiscussionChannel.Discussion;
    contentTitle = discussion?.title || "a discussion";
    channelName = fullComment.Channel?.uniqueName;
    contentUrl = `${process.env.FRONTEND_URL}/forums/${channelName}/discussions/${discussion?.id}`;
    commentPermalinkUrl = `${contentUrl}/comments/${parentCommentId}`;
  } else if (fullComment.Event) {
    const event = fullComment.Event;
    contentTitle = event?.title || "an event";
    channelName = fullComment.Channel?.uniqueName;
    contentUrl = `${process.env.FRONTEND_URL}/forums/${channelName}/events/${event?.id}`;
    commentPermalinkUrl = `${contentUrl}/comments/${parentCommentId}`;
  } else {
    logger.info("No content reference found for comment reply");
    return;
  }

  const baseNotificationText = `${commenterUsername} replied to your comment on [${contentTitle}](${commentPermalinkUrl})`;
  const notificationText = appendNotificationFooter(baseNotificationText, {
    contentType: "comment",
    contentUrl: commentPermalinkUrl,
  });

  const emailContent = createCommentReplyNotificationEmail(
    fullComment.text,
    contentTitle,
    commenterUsername,
    commentPermalinkUrl
  );

  const usersToNotify = resolveReplyNotificationRecipients({
    commenterUsername,
    parentCommentAuthor: parentComment.CommentAuthor,
    subscribedUsers: parentComment.SubscribedToNotifications,
  });

  if (usersToNotify.length === 0) {
    return;
  }

  if (!deps.driver) {
    logger.error("Driver not available for batch notifications");
    return;
  }

  await createNotificationsForUsers(
    deps,
    usersToNotify,
    notificationText,
    emailContent,
    "reply"
  );
};

/**
 * Notify the author of the content being given feedback. Delegates to the
 * feedback notification hook.
 */
export const processFeedbackNotification = async (
  deps: NotificationDeps,
  fullComment: any,
  commentId: string,
  authorUsername: string,
  authorDisplayName: string,
  channelUniqueName: string | null
): Promise<void> => {
  try {
    let targetAuthorUsername: string | null = null;
    let targetType: "comment" | "discussion" | "event" = "comment";
    let targetId: string | null = null;
    let discussionId: string | null = null;
    let eventId: string | null = null;

    if (fullComment.GivesFeedbackOnComment) {
      const feedbackTarget = fullComment.GivesFeedbackOnComment;
      targetAuthorUsername =
        feedbackTarget.CommentAuthor?.username ||
        feedbackTarget.CommentAuthor?.User?.username;
      targetType = "comment";
      targetId = feedbackTarget.id;
      discussionId = fullComment.DiscussionChannel?.discussionId;
      eventId = fullComment.Event?.id;
    } else if (fullComment.GivesFeedbackOnDiscussion) {
      const feedbackTarget = fullComment.GivesFeedbackOnDiscussion;
      targetAuthorUsername = feedbackTarget.Author?.username;
      targetType = "discussion";
      targetId = feedbackTarget.id;
      discussionId = feedbackTarget.id;
    } else if (fullComment.GivesFeedbackOnEvent) {
      const feedbackTarget = fullComment.GivesFeedbackOnEvent;
      targetAuthorUsername = feedbackTarget.Poster?.username;
      targetType = "event";
      targetId = feedbackTarget.id;
      eventId = feedbackTarget.id;
    }

    if (!targetAuthorUsername || !targetId) {
      return;
    }

    await notifyFeedback({
      context: { ogm: deps.ogm, driver: deps.driver },
      feedbackContext: {
        feedbackCommentId: commentId,
        authorUsername,
        authorDisplayName,
        targetType,
        targetId,
        channelUniqueName: channelUniqueName || undefined,
        discussionId: discussionId || undefined,
        eventId: eventId || undefined,
      },
      targetAuthorUsername,
    });
  } catch (error) {
    logger.error("Error processing feedback notification:", error);
  }
};

/**
 * Notify moderators mentioned with /m/modProfileName. Delegates to the mod
 * mention hook.
 */
export const processModMentionNotifications = async (
  deps: NotificationDeps,
  fullComment: any,
  commentId: string,
  authorUsername: string,
  authorLabel: string,
  channelUniqueName: string | null
): Promise<void> => {
  try {
    const discussionChannel = fullComment.DiscussionChannel;
    const event = fullComment.Event;

    await notifyModMentions({
      context: { ogm: deps.ogm, driver: deps.driver },
      mentionContext: {
        type: "comment",
        authorUsername,
        authorLabel,
        commentId,
        discussionId: discussionChannel?.discussionId,
        discussionTitle: discussionChannel?.Discussion?.title,
        eventId: event?.id,
        eventTitle: event?.title,
        channelUniqueName: channelUniqueName || undefined,
      },
      previousText: null,
      nextText: fullComment.text,
    });
  } catch (error) {
    logger.error("Error processing mod mention notifications:", error);
  }
};

/**
 * Notify users mentioned with @username. Delegates to the user mention hook.
 */
export const processUserMentionNotifications = async (
  deps: NotificationDeps,
  fullComment: any,
  commentId: string
): Promise<void> => {
  try {
    await notifyCommentMentions({
      context: { ogm: deps.ogm, driver: deps.driver },
      comment: {
        id: commentId,
        text: fullComment.text,
        CommentAuthor: fullComment.CommentAuthor,
        DiscussionChannel: fullComment.DiscussionChannel,
        Event: fullComment.Event,
      },
      previousText: null,
      nextText: fullComment.text,
    });
  } catch (error) {
    logger.error("Error processing user mention notifications:", error);
  }
};

/**
 * Entry point: load the full comment, then fan out to feedback, mod-mention,
 * user-mention, and the appropriate reply/discussion/event notification path.
 * This is the callable core that the subscription class delegates to.
 */
export const handleCommentCreatedNotification = async (
  deps: NotificationDeps,
  commentId: string
): Promise<void> => {
  const CommentModel = deps.ogm.model("Comment");

  const fullComments = await CommentModel.find({
    where: { id: commentId },
    selectionSet: FULL_COMMENT_SELECTION_SET,
  });

  if (!fullComments || !fullComments.length) {
    logger.error("Could not find comment details for ID:", commentId);
    return;
  }

  const fullComment = fullComments[0];

  const commenterUsername =
    fullComment.CommentAuthor?.username ||
    fullComment.CommentAuthor?.User?.username ||
    "Someone";

  const commenterDisplayName =
    fullComment.CommentAuthor?.displayName || commenterUsername;

  const authorLabel = `[@${commenterDisplayName}](/u/${commenterUsername})`;

  const channelUniqueName =
    fullComment.Channel?.uniqueName ||
    fullComment.DiscussionChannel?.channelUniqueName ||
    fullComment.Event?.EventChannels?.[0]?.channelUniqueName ||
    null;

  // FEEDBACK NOTIFICATION
  if (fullComment.isFeedbackComment) {
    await processFeedbackNotification(
      deps,
      fullComment,
      commentId,
      commenterUsername,
      commenterDisplayName,
      channelUniqueName
    );
  }

  // MOD MENTION NOTIFICATIONS (/m/modProfileName)
  await processModMentionNotifications(
    deps,
    fullComment,
    commentId,
    commenterUsername,
    authorLabel,
    channelUniqueName
  );

  // USER MENTION NOTIFICATIONS (@username)
  await processUserMentionNotifications(deps, fullComment, commentId);

  // REPLY takes precedence (a reply can also carry a DiscussionChannel/Event).
  if (fullComment.ParentComment) {
    await processCommentReplyNotification(deps, fullComment, commentId, commenterUsername);
  } else if (fullComment.DiscussionChannel) {
    await processDiscussionCommentNotification(deps, fullComment, commentId, commenterUsername);
  } else if (fullComment.Event) {
    await processEventCommentNotification(deps, fullComment, commentId, commenterUsername);
  }
};
