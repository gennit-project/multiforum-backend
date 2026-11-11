import type {User,ModerationProfile,Comment,Discussion,DiscussionChannel,Event,Issue} from '../../src/generated/graphql.js';

import type {Selection,Projection} from './selection.js';

// Fixed notification read selections. JSON contents are not decoded here.

export const mentionAuthorUserSelection = {
  "username": true,
  "displayName": true
} as const satisfies Selection<User>;

export const mentionAuthorModSelection = {
  "displayName": true,
  "User": {
    "username": true
  }
} as const satisfies Selection<ModerationProfile>;

export const mentionAuthorSelection={'... on User':mentionAuthorUserSelection,'... on ModerationProfile':mentionAuthorModSelection} as const;

export type MentionAuthor=(Projection<User,typeof mentionAuthorUserSelection> & {User?:never;}) | (Projection<ModerationProfile,typeof mentionAuthorModSelection> & {username?:never;});

export const notificationMentionCoreSelection = {
  "id": true,
  "text": true,
  "DiscussionChannel": {
    "discussionId": true,
    "channelUniqueName": true,
    "Discussion": {
      "id": true,
      "title": true
    }
  },
  "Event": {
    "id": true,
    "title": true,
    "EventChannels": {
      "channelUniqueName": true
    }
  }
} as const satisfies Selection<Comment>;

export const notificationMentionSelection={...notificationMentionCoreSelection,CommentAuthor:mentionAuthorSelection} as const;

export type NotificationMentionComment=Projection<Comment,typeof notificationMentionCoreSelection> & {CommentAuthor:MentionAuthor|null};

export const notificationDiscussionSelection = {
  "id": true,
  "title": true,
  "body": true,
  "Author": {
    "username": true,
    "displayName": true
  },
  "DiscussionChannels": {
    "channelUniqueName": true
  }
} as const satisfies Selection<Discussion>;

export type NotificationMentionDiscussion=Projection<Discussion,typeof notificationDiscussionSelection>;

export const notificationAuthorUserSelection = {
  "__typename": true,
  "username": true,
  "displayName": true
} as const satisfies Selection<User>;

export const notificationAuthorModSelection = {
  "__typename": true,
  "displayName": true,
  "User": {
    "username": true
  }
} as const satisfies Selection<ModerationProfile>;

export const notificationAuthorSelection={'... on User':notificationAuthorUserSelection,'... on ModerationProfile':notificationAuthorModSelection} as const;

export type NotificationAuthor=(Projection<User,typeof notificationAuthorUserSelection> & {User?:never;__typename:'User';}) | (Projection<ModerationProfile,typeof notificationAuthorModSelection> & {username?:never;__typename:'ModerationProfile';});

export const feedbackAuthorUserSelection = {
  "username": true
} as const satisfies Selection<User>;

export const feedbackAuthorModSelection = {
  "User": {
    "username": true
  }
} as const satisfies Selection<ModerationProfile>;

export const feedbackAuthorSelection={'... on User':feedbackAuthorUserSelection,'... on ModerationProfile':feedbackAuthorModSelection} as const;

export type FeedbackAuthor=(Projection<User,typeof feedbackAuthorUserSelection> & {User?:never;}) | (Projection<ModerationProfile,typeof feedbackAuthorModSelection> & {username?:never;});

export const replyAuthorUserSelection = {
  "__typename": true,
  "username": true,
  "notifyOnReplyToCommentByDefault": true,
  "Email": {
    "address": true
  }
} as const satisfies Selection<User>;

export const replyAuthorModSelection = {
  "__typename": true,
  "displayName": true,
  "User": {
    "username": true,
    "notifyOnReplyToCommentByDefault": true,
    "Email": {
      "address": true
    }
  }
} as const satisfies Selection<ModerationProfile>;

export const replyAuthorSelection={'... on User':replyAuthorUserSelection,'... on ModerationProfile':replyAuthorModSelection} as const;

export type ReplyAuthor=(Projection<User,typeof replyAuthorUserSelection> & {User?:never;__typename:'User';}) | (Projection<ModerationProfile,typeof replyAuthorModSelection> & {username?:never;__typename:'ModerationProfile';});

export const notificationFeedbackCoreSelection = {
  "id": true
} as const satisfies Selection<Comment>;

export const notificationParentCoreSelection = {
  "id": true,
  "text": true,
  "SubscribedToNotifications": {
    "username": true,
    "Email": {
      "address": true
    }
  }
} as const satisfies Selection<Comment>;

export const notificationCommentCoreSelection = {
  "id": true,
  "text": true,
  "isRootComment": true,
  "isFeedbackComment": true,
  "Channel": {
    "uniqueName": true
  },
  "DiscussionChannel": {
    "id": true,
    "discussionId": true,
    "channelUniqueName": true,
    "Channel": {
      "uniqueName": true,
      "displayName": true
    },
    "Discussion": {
      "id": true,
      "title": true,
      "Author": {
        "username": true
      }
    },
    "SubscribedToNotifications": {
      "username": true
    }
  },
  "Event": {
    "id": true,
    "title": true,
    "Poster": {
      "username": true
    },
    "EventChannels": {
      "channelUniqueName": true,
      "Channel": {
        "uniqueName": true
      }
    },
    "SubscribedToNotifications": {
      "username": true
    }
  },
  "GivesFeedbackOnDiscussion": {
    "id": true,
    "Author": {
      "username": true
    }
  },
  "GivesFeedbackOnEvent": {
    "id": true,
    "Poster": {
      "username": true
    }
  }
} as const satisfies Selection<Comment>;

export const notificationFeedbackSelection={...notificationFeedbackCoreSelection,CommentAuthor:feedbackAuthorSelection} as const;

export const notificationParentSelection={...notificationParentCoreSelection,CommentAuthor:replyAuthorSelection} as const;

export const notificationCommentSelection={...notificationCommentCoreSelection,CommentAuthor:notificationAuthorSelection,GivesFeedbackOnComment:notificationFeedbackSelection,ParentComment:notificationParentSelection} as const;

export type NotificationComment=Projection<Comment,typeof notificationCommentCoreSelection> & {CommentAuthor:NotificationAuthor|null;GivesFeedbackOnComment:(Projection<Comment,typeof notificationFeedbackCoreSelection> & {CommentAuthor:FeedbackAuthor|null})|null;ParentComment:(Projection<Comment,typeof notificationParentCoreSelection> & {CommentAuthor:ReplyAuthor|null})|null;};

export const notificationArchivedAuthorSelection = {
  "username": true
} as const satisfies Selection<User>;

export const notificationFeedbackRecipientSelection = {
  "username": true,
  "notifyOnFeedback": true
} as const satisfies Selection<User>;

export const notificationMentionRecipientSelection = {
  "username": true,
  "notifyWhenTagged": true,
  "Email": {
    "address": true
  }
} as const satisfies Selection<User>;

export const notificationSubscriberSelection = {
  "username": true,
  "Email": {
    "address": true
  }
} as const satisfies Selection<User>;

export const notificationEntitySubscribersSelection = {
  "id": true,
  "SubscribedToNotifications": {
    "username": true,
    "Email": {
      "address": true
    }
  }
} as const satisfies Selection<DiscussionChannel>;

notificationEntitySubscribersSelection satisfies Selection<Event>;

notificationEntitySubscribersSelection satisfies Selection<Comment>;

export const notificationIssueSubscribersSelection = {
  "id": true,
  "issueNumber": true,
  "title": true,
  "channelUniqueName": true,
  "SubscribedToNotifications": {
    "username": true,
    "notifyOnSubscribedIssueUpdates": true,
    "Email": {
      "address": true
    }
  }
} as const satisfies Selection<Issue>;

export type NotificationArchivedAuthor=Projection<User,typeof notificationArchivedAuthorSelection>;

export type NotificationFeedbackRecipient=Projection<User,typeof notificationFeedbackRecipientSelection>;

export type NotificationMentionRecipient=Projection<User,typeof notificationMentionRecipientSelection>;

export type SubscriberSnapshot=Projection<User,typeof notificationSubscriberSelection>;

export type NotificationEntitySubscribers=Projection<DiscussionChannel,typeof notificationEntitySubscribersSelection>;

export type NotificationIssueSubscribers=Projection<Issue,typeof notificationIssueSubscribersSelection>;
