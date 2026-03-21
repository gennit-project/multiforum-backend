type CommentWithSubscriptions = {
  id?: string | null;
  SubscribedToNotifications?: Array<{ username: string }>;
  [key: string]: any;
};

type Input = {
  comments: CommentWithSubscriptions[];
  loggedInUsername: string | null;
  session: any;
};

export const populateCommentSubscriptionStatus = async ({
  comments,
  loggedInUsername,
  session,
}: Input): Promise<CommentWithSubscriptions[]> => {
  const normalizedComments = comments.map((comment) => ({
    ...comment,
    SubscribedToNotifications: [],
  }));

  if (!loggedInUsername || normalizedComments.length === 0) {
    return normalizedComments;
  }

  const commentIds = normalizedComments
    .map((comment) => comment.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  if (commentIds.length === 0) {
    return normalizedComments;
  }

  const result = await session.run(
    `
      MATCH (:User {username: $loggedInUsername})-[:SUBSCRIBED_TO_NOTIFICATIONS]->(comment:Comment)
      WHERE comment.id IN $commentIds
      RETURN collect(comment.id) AS subscribedCommentIds
    `,
    {
      loggedInUsername,
      commentIds,
    }
  );

  const subscribedCommentIds = new Set<string>(
    (result.records[0]?.get("subscribedCommentIds") as string[] | undefined) ?? []
  );

  return normalizedComments.map((comment) => ({
    ...comment,
    SubscribedToNotifications: subscribedCommentIds.has(comment.id ?? "")
      ? [{ username: loggedInUsername }]
      : [],
  }));
};
