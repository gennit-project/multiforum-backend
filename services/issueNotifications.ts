import { sendBatchEmails } from "./mail/index.js";
import { createIssueSubscriptionNotificationEmail } from "../customResolvers/mutations/shared/emailUtils.js";

type IssueNotificationDependencies = {
  sendBatchEmails?: typeof sendBatchEmails;
  createIssueSubscriptionNotificationEmail?: typeof createIssueSubscriptionNotificationEmail;
};

type NotifyIssueSubscribersInput = {
  IssueModel: any;
  driver: any;
  issueId: string;
  actorUsername?: string | null;
  actionType?: string | null;
  actionDescription: string;
  commentText?: string | null;
  dependencies?: IssueNotificationDependencies;
};

type IssueSubscriber = {
  username: string;
  notifyOnSubscribedIssueUpdates?: boolean | null;
  Email?: { address?: string | null } | null;
};

const buildIssueUrl = (
  channelUniqueName?: string | null,
  issueNumber?: number | null
) => {
  if (!process.env.FRONTEND_URL || !channelUniqueName || issueNumber == null) {
    return "";
  }

  return `${process.env.FRONTEND_URL}/forums/${channelUniqueName}/issues/${issueNumber}`;
};

const getIssueNotificationCopy = (input: {
  issueNumber?: number | null;
  issueTitle?: string | null;
  actionType?: string | null;
  actionDescription: string;
}) => {
  const { issueNumber, issueTitle, actionType, actionDescription } = input;
  const issueLabel = issueNumber != null ? `Issue #${issueNumber}` : "Issue";
  const titleSuffix = issueTitle ? `: ${issueTitle}` : "";

  if (actionType === "comment") {
    return {
      notificationText: `New reply on ${issueLabel}${titleSuffix}`,
      subject: `New reply on ${issueLabel}`,
      summary: `There is a new reply on ${issueLabel}${titleSuffix}.`,
    };
  }

  return {
    notificationText: `${issueLabel} was updated: ${actionDescription}`,
    subject: `${issueLabel} was updated`,
    summary: `${issueLabel}${titleSuffix} was updated: ${actionDescription}.`,
  };
};

export const notifyIssueSubscribers = async ({
  IssueModel,
  driver,
  issueId,
  actorUsername = null,
  actionType = null,
  actionDescription,
  commentText = null,
  dependencies,
}: NotifyIssueSubscribersInput): Promise<boolean> => {
  if (!issueId || actionType === "report") {
    return false;
  }

  const sendBatchEmailsFn = dependencies?.sendBatchEmails || sendBatchEmails;
  const createIssueSubscriptionNotificationEmailFn =
    dependencies?.createIssueSubscriptionNotificationEmail ||
    createIssueSubscriptionNotificationEmail;

  const [issue] = await IssueModel.find({
    where: { id: issueId },
    selectionSet: `{
      id
      issueNumber
      title
      channelUniqueName
      SubscribedToNotifications {
        username
        notifyOnSubscribedIssueUpdates
        Email {
          address
        }
      }
    }`,
  });

  if (!issue) {
    return false;
  }

  const subscribers: IssueSubscriber[] = (issue.SubscribedToNotifications || []).filter(
    (subscriber: IssueSubscriber) =>
      subscriber.username && subscriber.username !== actorUsername
  );

  if (!subscribers.length) {
    return false;
  }

  const copy = getIssueNotificationCopy({
    issueNumber: issue.issueNumber,
    issueTitle: issue.title,
    actionType,
    actionDescription,
  });
  const issueUrl = buildIssueUrl(issue.channelUniqueName, issue.issueNumber);
  const emailContent = createIssueSubscriptionNotificationEmailFn(
    copy.subject,
    copy.summary,
    commentText || "",
    issueUrl
  );

  const emailMessages = subscribers
    .filter(
      (subscriber) =>
        subscriber.notifyOnSubscribedIssueUpdates !== false &&
        subscriber.Email?.address
    )
    .map((subscriber) => ({
      to: subscriber.Email!.address!,
      subject: emailContent.subject,
      text: emailContent.plainText,
      html: emailContent.html,
    }));

  if (emailMessages.length > 0) {
    await sendBatchEmailsFn(emailMessages);
  }

  const session = driver.session();
  try {
    await session.run(
      `
      UNWIND $usernames AS username
      MATCH (user:User {username: username})
      CREATE (notification:Notification {
        id: randomUUID(),
        createdAt: datetime(),
        read: false,
        text: $notificationText
      })
      CREATE (user)-[:HAS_NOTIFICATION]->(notification)
      `,
      {
        usernames: subscribers.map((subscriber) => subscriber.username),
        notificationText: copy.notificationText,
      }
    );
  } finally {
    await session.close();
  }

  return true;
};
