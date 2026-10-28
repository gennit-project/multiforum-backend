import type { Driver } from "neo4j-driver";

/**
 * FAMILY-3 / v7 (campaign #284). Comment creation.
 *
 * v7 removed the to-one `connect` from create inputs, so the generated
 * createComments can no longer wire a comment's author / container / parent /
 * feedback target. The custom createCommentWithOwnedConnections resolver creates
 * the comment with scalars through the generated mutation (for a correctly typed
 * projection) and then owns these edges here:
 *
 *   (author:User|ModerationProfile)-[:AUTHORED_COMMENT]->(comment)
 *   (dc:DiscussionChannel)-[:CONTAINS_COMMENT]->(comment)
 *   (event:Event)-[:HAS_COMMENT]->(comment)
 *   (channel:Channel)-[:HAS_COMMENT]->(comment)
 *   (comment)-[:IS_REPLY_TO]->(parent:Comment)
 *   (comment)-[:HAS_FEEDBACK_COMMENT]->(Comment|Discussion|Event)
 *
 * The edges are owned inside a managed transaction (session.executeWrite) that
 * re-stamps ageGateTouchedAt, so the age-gate reconcile (which only runs on
 * managed/explicit transactions, keyed on nodes touched in the current
 * transaction) re-evaluates the comment with its container/parent edges present
 * — e.g. a reply under sensitive content is restricted in that write.
 */

export type OwnedCommentTargets = {
  authorUsername: string | null;
  authorModProfileName: string | null;
  discussionChannelId: string | null;
  eventId: string | null;
  channelUniqueName: string | null;
  parentCommentId: string | null;
  feedbackCommentId: string | null;
  feedbackDiscussionId: string | null;
  feedbackEventId: string | null;
  // To-many connects the client sends on create: author self-upvote and
  // notification auto-subscribe (lists of usernames).
  upvoterUsernames: string[];
  subscriberUsernames: string[];
};

const connectId = (field: unknown): string | null =>
  (field as { connect?: { where?: { node?: { id?: string } } } } | null | undefined)
    ?.connect?.where?.node?.id ?? null;

// Pull the usernames out of a to-many { connect: [{ where: { node: { username } } }] } field.
const connectUsernames = (field: unknown): string[] => {
  const connect = (field as { connect?: unknown } | null | undefined)?.connect;
  const entries = Array.isArray(connect) ? connect : connect ? [connect] : [];
  return entries
    .map((entry) => (entry as { where?: { node?: { username?: string } } } | null)?.where?.node?.username)
    .filter((username): username is string => typeof username === "string" && username.length > 0);
};

// Split a connect-shaped OwnedCommentCreateInput into the scalar create map
// (relationship fields removed) and the to-one target identifiers to own.
export function splitOwnedCommentInput(input: unknown): {
  scalars: Record<string, unknown>;
  targets: OwnedCommentTargets;
} {
  const {
    CommentAuthor,
    DiscussionChannel,
    Event,
    Channel,
    ParentComment,
    GivesFeedbackOnComment,
    GivesFeedbackOnDiscussion,
    GivesFeedbackOnEvent,
    UpvotedByUsers,
    SubscribedToNotifications,
    Issue,
    ...rest
  } = (input as Record<string, any>) ?? {};
  void Issue;
  // Keep only defined, primitive scalar values for the generated create.
  const scalars = Object.fromEntries(
    Object.entries(rest).filter(
      ([, value]) => value !== undefined && value !== null && typeof value !== "object"
    )
  );
  const author = CommentAuthor as
    | { User?: unknown; ModerationProfile?: unknown }
    | null
    | undefined;
  return {
    scalars,
    targets: {
      authorUsername:
        (author?.User as { connect?: { where?: { node?: { username?: string } } } } | undefined)
          ?.connect?.where?.node?.username ?? null,
      authorModProfileName:
        (author?.ModerationProfile as { connect?: { where?: { node?: { displayName?: string } } } } | undefined)
          ?.connect?.where?.node?.displayName ?? null,
      discussionChannelId: connectId(DiscussionChannel),
      eventId: connectId(Event),
      channelUniqueName:
        (Channel as { connect?: { where?: { node?: { uniqueName?: string } } } } | null | undefined)
          ?.connect?.where?.node?.uniqueName ?? null,
      parentCommentId: connectId(ParentComment),
      feedbackCommentId: connectId(GivesFeedbackOnComment),
      feedbackDiscussionId: connectId(GivesFeedbackOnDiscussion),
      feedbackEventId: connectId(GivesFeedbackOnEvent),
      upvoterUsernames: connectUsernames(UpvotedByUsers),
      subscriberUsernames: connectUsernames(SubscribedToNotifications),
    },
  };
}

// Best-effort owned wiring: each edge is a unit subquery that no-ops when its
// endpoint is absent, mirroring the tolerance of the removed nested connects.
const OWN_COMMENT_EDGES = `
 MATCH (c:Comment {id: $commentId})
 SET c.ageGateTouchedAt = datetime()
 WITH c
 CALL { WITH c OPTIONAL MATCH (u:User {username: $authorUsername}) FOREACH (_ IN CASE WHEN u IS NULL THEN [] ELSE [1] END | MERGE (u)-[:AUTHORED_COMMENT]->(c)) }
 CALL { WITH c OPTIONAL MATCH (m:ModerationProfile {displayName: $authorModProfileName}) FOREACH (_ IN CASE WHEN m IS NULL THEN [] ELSE [1] END | MERGE (m)-[:AUTHORED_COMMENT]->(c)) }
 CALL { WITH c OPTIONAL MATCH (dc:DiscussionChannel {id: $discussionChannelId}) FOREACH (_ IN CASE WHEN dc IS NULL THEN [] ELSE [1] END | MERGE (dc)-[:CONTAINS_COMMENT]->(c)) }
 CALL { WITH c OPTIONAL MATCH (e:Event {id: $eventId}) FOREACH (_ IN CASE WHEN e IS NULL THEN [] ELSE [1] END | MERGE (e)-[:HAS_COMMENT]->(c)) }
 CALL { WITH c OPTIONAL MATCH (ch:Channel {uniqueName: $channelUniqueName}) FOREACH (_ IN CASE WHEN ch IS NULL THEN [] ELSE [1] END | MERGE (ch)-[:HAS_COMMENT]->(c)) }
 CALL { WITH c OPTIONAL MATCH (p:Comment {id: $parentCommentId}) FOREACH (_ IN CASE WHEN p IS NULL THEN [] ELSE [1] END | MERGE (c)-[:IS_REPLY_TO]->(p)) }
 CALL { WITH c OPTIONAL MATCH (fc:Comment {id: $feedbackCommentId}) FOREACH (_ IN CASE WHEN fc IS NULL THEN [] ELSE [1] END | MERGE (c)-[:HAS_FEEDBACK_COMMENT]->(fc)) }
 CALL { WITH c OPTIONAL MATCH (fd:Discussion {id: $feedbackDiscussionId}) FOREACH (_ IN CASE WHEN fd IS NULL THEN [] ELSE [1] END | MERGE (c)-[:HAS_FEEDBACK_COMMENT]->(fd)) }
 CALL { WITH c OPTIONAL MATCH (fe:Event {id: $feedbackEventId}) FOREACH (_ IN CASE WHEN fe IS NULL THEN [] ELSE [1] END | MERGE (c)-[:HAS_FEEDBACK_COMMENT]->(fe)) }
 CALL { WITH c UNWIND $upvoterUsernames AS upvoter MATCH (uu:User {username: upvoter}) MERGE (uu)-[:UPVOTED_COMMENT]->(c) }
 CALL { WITH c UNWIND $subscriberUsernames AS subscriber MATCH (su:User {username: subscriber}) MERGE (su)-[:SUBSCRIBED_TO_NOTIFICATIONS]->(c) }
`;

export async function ownCommentConnections(
  driver: Driver,
  commentId: string,
  targets: OwnedCommentTargets
): Promise<void> {
  const session = driver.session();
  try {
    await session.executeWrite((tx) => tx.run(OWN_COMMENT_EDGES, { commentId, ...targets }));
  } finally {
    await session.close();
  }
}
