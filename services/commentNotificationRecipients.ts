export type NotificationRecipient = {
  username: string;
  email: string | null;
};

type ParentCommentAuthor =
  | {
      __typename?: "User";
      username?: string | null;
      notifyOnReplyToCommentByDefault?: boolean | null;
      Email?: {
        address?: string | null;
      } | null;
    }
  | {
      __typename?: "ModerationProfile";
      displayName?: string | null;
      User?: {
        username?: string | null;
        notifyOnReplyToCommentByDefault?: boolean | null;
        Email?: {
          address?: string | null;
        } | null;
      } | null;
    }
  | null;

type SubscribedUser = {
  username?: string | null;
  Email?: {
    address?: string | null;
  } | null;
};

type ResolveReplyRecipientsInput = {
  commenterUsername: string;
  parentCommentAuthor?: ParentCommentAuthor;
  subscribedUsers?: SubscribedUser[] | null;
};

const addRecipient = (
  recipients: Map<string, NotificationRecipient>,
  username: string | null | undefined,
  email: string | null | undefined
) => {
  if (!username) {
    return;
  }

  const existing = recipients.get(username);
  if (existing) {
    if (!existing.email && email) {
      recipients.set(username, { username, email });
    }
    return;
  }

  recipients.set(username, {
    username,
    email: email || null,
  });
};

export const resolveReplyNotificationRecipients = ({
  commenterUsername,
  parentCommentAuthor,
  subscribedUsers,
}: ResolveReplyRecipientsInput): NotificationRecipient[] => {
  const recipients = new Map<string, NotificationRecipient>();

  if (parentCommentAuthor?.__typename === "User") {
    if (parentCommentAuthor.notifyOnReplyToCommentByDefault) {
      addRecipient(
        recipients,
        parentCommentAuthor.username,
        parentCommentAuthor.Email?.address
      );
    }
  } else if (parentCommentAuthor?.__typename === "ModerationProfile") {
    if (parentCommentAuthor.User?.notifyOnReplyToCommentByDefault) {
      addRecipient(
        recipients,
        parentCommentAuthor.User?.username,
        parentCommentAuthor.User?.Email?.address
      );
    }
  }

  for (const subscribedUser of subscribedUsers || []) {
    addRecipient(recipients, subscribedUser.username, subscribedUser.Email?.address);
  }

  recipients.delete(commenterUsername);

  return Array.from(recipients.values());
};
