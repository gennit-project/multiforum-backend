import { delegateQueryField } from "../../services/persistence/delegateQueryField.js";
import type { Driver } from "neo4j-driver";
import { GraphQLError, type GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";
import { getGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";

// v7 (campaign #284): the frontend used to add a moderation activity-feed item by
// calling updateIssues with a nested `create: { ActivityFeed: [...] }` (and, for
// the comment variants, a nested Comment create wiring Channel / Issue /
// CommentAuthor). v7 removed nested relationship create from updateIssues and the
// to-one connects it relied on, so that whole write moves here as owned Cypher.
//
// One mutation covers all three frontend variants:
//   - action only                       (displayName)
//   - action + comment authored by a mod (displayName + commentText/channelUniqueName)
//   - action + comment authored by a user (username  + commentText/channelUniqueName)
// The actor and (when present) the comment author are the same identity — a
// ModerationProfile (displayName) or a User (username) — so one pair of params
// drives both edges. A missing endpoint is a no-op, mirroring the old nested
// connect's tolerance.

const CREATE_ACTION = `
 MATCH (i:Issue {id: $issueId})
 CREATE (a:ModerationAction {id: randomUUID(), actionType: $actionType, actionDescription: $actionDescription, createdAt: datetime()})
 CREATE (i)-[:ACTIVITY_ON_ISSUE]->(a)
 WITH i, a
 CALL { WITH a OPTIONAL MATCH (mod:ModerationProfile {displayName: $displayName}) FOREACH (_ IN CASE WHEN mod IS NULL THEN [] ELSE [1] END | MERGE (mod)-[:PERFORMED_MODERATION_ACTION]->(a)) }
 CALL { WITH a OPTIONAL MATCH (u:User {username: $username}) FOREACH (_ IN CASE WHEN u IS NULL THEN [] ELSE [1] END | MERGE (u)-[:PERFORMED_MODERATION_ACTION]->(a)) }
 FOREACH (_ IN CASE WHEN $setFlagged THEN [1] ELSE [] END | SET i.flaggedServerRuleViolation = $flaggedServerRuleViolation)
 RETURN a.id AS actionId
`;

const CREATE_MODERATED_COMMENT = `
 MATCH (i:Issue {id: $issueId})
 MATCH (a:ModerationAction {id: $actionId})
 CREATE (c:Comment {id: randomUUID(), text: $commentText, isRootComment: false, createdAt: datetime()})
 CREATE (a)-[:MODERATED_COMMENT]->(c)
 CREATE (c)-[:ACTIVITY_ON_ISSUE]->(i)
 WITH c
 CALL { WITH c OPTIONAL MATCH (ch:Channel {uniqueName: $channelUniqueName}) FOREACH (_ IN CASE WHEN ch IS NULL THEN [] ELSE [1] END | MERGE (ch)-[:HAS_COMMENT]->(c)) }
 CALL { WITH c OPTIONAL MATCH (mod:ModerationProfile {displayName: $displayName}) FOREACH (_ IN CASE WHEN mod IS NULL THEN [] ELSE [1] END | MERGE (mod)-[:AUTHORED_COMMENT]->(c)) }
 CALL { WITH c OPTIONAL MATCH (u:User {username: $username}) FOREACH (_ IN CASE WHEN u IS NULL THEN [] ELSE [1] END | MERGE (u)-[:AUTHORED_COMMENT]->(c)) }
`;

type Args = {
  where?: { id?: { eq?: string | null } | null } | null;
  actionType?: string | null;
  actionDescription?: string | null;
  displayName?: string | null;
  username?: string | null;
  commentText?: string | null;
  channelUniqueName?: string | null;
  flaggedServerRuleViolation?: boolean | null;
};
type Input = { driver: Driver };

const getResolver = (deps: Input) => {
  const { driver } = deps;
  return async (_parent: unknown, args: Args, _context: GraphQLContext, _info: GraphQLResolveInfo) => {
    const issueId = args.where?.id?.eq;
    if (!issueId) throw new GraphQLError("addIssueActivityFeedItem requires where.id.eq");

    const params = {
      issueId,
      actionType: args.actionType ?? null,
      actionDescription: args.actionDescription ?? null,
      displayName: args.displayName ?? null,
      username: args.username ?? null,
      commentText: args.commentText ?? null,
      channelUniqueName: args.channelUniqueName ?? null,
      setFlagged:
        args.flaggedServerRuleViolation !== undefined && args.flaggedServerRuleViolation !== null,
      flaggedServerRuleViolation: args.flaggedServerRuleViolation ?? null,
    };

    // Action creation + optional moderated-comment creation share one managed
    // transaction so a partial write rolls back.
    const session = driver.session();
    try {
      await session.executeWrite(async (tx) => {
        const actionResult = await tx.run<{actionId:string}>(CREATE_ACTION, params);
        const actionId = actionResult.records[0]?.get("actionId");
        if (params.commentText && actionId) {
          await tx.run(CREATE_MODERATED_COMMENT, { ...params, actionId });
        }
      });
    } finally {
      await session.close();
    }

    // Resolve each payload selection with its own GraphQL info. Delegation carries
    // fragments, aliases, directive/argument variables and merged field nodes.
    // The write remains above this resolver so multiple payload aliases cannot
    // create duplicate actions or comments.
    return {
      issues: (_args: unknown, _context: GraphQLContext, payloadInfo: GraphQLResolveInfo): unknown =>
        delegateQueryField({
          schema: getGeneratedSchema(driver),
          fieldName: "issues",
          args: { where: { id: { eq: issueId } } },
          // Preserve the existing post-moderation sensitive-content read policy.
          // Public nested fields still pass through the caller's Shield schema.
          context: { jwt: { mayAccessSensitiveContent: true } },
          info: payloadInfo,
        }),
    };
  };
};

export default getResolver;
