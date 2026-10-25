import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
import type { Driver } from "neo4j-driver";
import type { Comment, Issue } from "../../ogm_types.js";
import type { CommentSnapshot } from "../../utils/buildCommentMentionContext.js";
import type { DiscussionSnapshot } from "../../utils/buildDiscussionMentionContext.js";

export type SubscriberSnapshot = { username: string; Email?: {address: string} | null };
export interface NotificationSnapshotRepository {
  findArchivedAuthor(username: string): Promise<{username: string}[]>;
  findFeedbackRecipient(username: string): Promise<{username: string; notifyOnFeedback: boolean | null}[]>;
  findMentionRecipients(usernames: string[]): Promise<{username: string; notifyWhenTagged: boolean | null; Email?: {address:string} | null}[]>;
  findCommentMentionSnapshot(id: string): Promise<CommentSnapshot[]>;
  findDiscussionMentionSnapshot(id: string): Promise<DiscussionSnapshot[]>;
  findCommentNotificationSnapshot(id: string): Promise<Pick<Comment, "id" | "text" | "isRootComment" | "isFeedbackComment" | "Channel" | "CommentAuthor" | "DiscussionChannel" | "Event" | "GivesFeedbackOnComment" | "GivesFeedbackOnDiscussion" | "GivesFeedbackOnEvent" | "ParentComment">[]>;
  findEntitySubscribers(type: "DiscussionChannel" | "Event" | "Comment", id: string): Promise<{id:string; SubscribedToNotifications: SubscriberSnapshot[]}[]>;
  findIssueSubscribers(id: string): Promise<Pick<Issue, "id" | "issueNumber" | "title" | "channelUniqueName" | "SubscribedToNotifications">[]>;
}

const COMMENT_SELECTION_SET = `{
  id
  text
  CommentAuthor {
    ... on User {
      username
      displayName
    }
    ... on ModerationProfile {
      displayName
      User {
        username
      }
    }
  }
  DiscussionChannel {
    discussionId
    channelUniqueName
    Discussion {
      id
      title
    }
  }
  Event {
    id
    title
    EventChannels {
      channelUniqueName
    }
  }
}`;

const DISCUSSION_SELECTION_SET = `{
  id
  title
  body
  Author {
    username
    displayName
  }
  DiscussionChannels {
    channelUniqueName
  }
}`;

const FULL_COMMENT_SELECTION_SET = `{
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

const SUBSCRIBERS = `{ id SubscribedToNotifications { username Email { address } } }`;
const OPERATIONS = {
  archived: `query ArchivedAuthor($where: UserWhere) { users(where:$where) {username} }`,
  feedback: `query FeedbackRecipient($where: UserWhere) { users(where:$where) {username notifyOnFeedback} }`,
  mentions: `query MentionRecipients($where: UserWhere) { users(where:$where) {username notifyWhenTagged Email {address}} }`,
  commentMention: `query CommentMentionSnapshot($where: CommentWhere) { comments(where:$where) ${COMMENT_SELECTION_SET} }`,
  discussionMention: `query DiscussionMentionSnapshot($where: DiscussionWhere) { discussions(where:$where) ${DISCUSSION_SELECTION_SET} }`,
  commentNotification: `query CommentNotificationSnapshot($where: CommentWhere) { comments(where:$where) ${FULL_COMMENT_SELECTION_SET} }`,
  issue: `query IssueSubscribers($where: IssueWhere) { issues(where:$where) { id issueNumber title channelUniqueName SubscribedToNotifications {username notifyOnSubscribedIssueUpdates Email {address}} } }`,
};
const ENTITY_OPERATIONS = {
  DiscussionChannel: {root: "discussionChannels", source: `query DiscussionSubscribers($where:DiscussionChannelWhere){discussionChannels(where:$where) ${SUBSCRIBERS}}`},
  Event: {root: "events", source: `query EventSubscribers($where:EventWhere){events(where:$where) ${SUBSCRIBERS}}`},
  Comment: {root: "comments", source: `query CommentSubscribers($where:CommentWhere){comments(where:$where) ${SUBSCRIBERS}}`},
} as const;

// Fixed domain snapshots preserve generated schema filters, per-type default
// limits, union resolution and scalar errors without rebuilding those policies.
export function createNotificationSnapshotRepository(driver: Driver): NotificationSnapshotRepository {
  return {
    async findArchivedAuthor(username) {
      return (await executeGeneratedOperation<{users:{username:string}[]}>(driver, OPERATIONS.archived, {where:{username}})).users;
    },
    async findFeedbackRecipient(username) {
      return (await executeGeneratedOperation<{users:Awaited<ReturnType<NotificationSnapshotRepository["findFeedbackRecipient"]>>}>(driver, OPERATIONS.feedback, {where:{username}})).users;
    },
    async findMentionRecipients(usernames) {
      return (await executeGeneratedOperation<{users:Awaited<ReturnType<NotificationSnapshotRepository["findMentionRecipients"]>>}>(driver, OPERATIONS.mentions, {where:{username:{in:usernames}}})).users;
    },
    async findCommentMentionSnapshot(id) {
      return (await executeGeneratedOperation<{comments:CommentSnapshot[]}>(driver, OPERATIONS.commentMention, {where:{id:{eq:id}}})).comments;
    },
    async findDiscussionMentionSnapshot(id) {
      return (await executeGeneratedOperation<{discussions:DiscussionSnapshot[]}>(driver, OPERATIONS.discussionMention, {where:{id:{eq:id}}})).discussions;
    },
    async findCommentNotificationSnapshot(id) {
      return (await executeGeneratedOperation<{comments:Awaited<ReturnType<NotificationSnapshotRepository["findCommentNotificationSnapshot"]>>}>(driver, OPERATIONS.commentNotification, {where:{id:{eq:id}}})).comments;
    },
    async findEntitySubscribers(type, id) {
      const operation = ENTITY_OPERATIONS[type];
      const result = await executeGeneratedOperation<Record<string, {id:string;SubscribedToNotifications:SubscriberSnapshot[]}[]>>(driver, operation.source, {where:{id:{eq:id}}});
      return result[operation.root];
    },
    async findIssueSubscribers(id) {
      return (await executeGeneratedOperation<{issues:Awaited<ReturnType<NotificationSnapshotRepository["findIssueSubscribers"]>>}>(driver, OPERATIONS.issue, {where:{id:{eq:id}}})).issues;
    },
  };
}

export const resolveNotificationSnapshotRepository = (context: {
  driver?: Driver;
  notificationSnapshotRepository?: NotificationSnapshotRepository;
}): NotificationSnapshotRepository => {
  if (context.notificationSnapshotRepository) return context.notificationSnapshotRepository;
  if (!context.driver) throw new Error("Driver is required for notification snapshots");
  return createNotificationSnapshotRepository(context.driver);
};

export { FULL_COMMENT_SELECTION_SET };
