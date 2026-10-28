import type { Driver } from "neo4j-driver";
import { GraphQLError, print, type GraphQLResolveInfo, type SelectionSetNode } from "graphql";
import type { GraphQLContext } from "../../types/context.js";
import { executeGeneratedOperation } from "../../services/persistence/generatedSchemaOperations.js";

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

// Reproduce the client's requested `issues` selection so the generated refetch
// returns exactly what the caller asked for (the frontend's deep IssueFields
// tree). Fragments the selection references are inlined by re-declaring every
// reachable fragment definition alongside the query.
function buildIssuesRefetchQuery(info: GraphQLResolveInfo): string {
  const fieldNode = info.fieldNodes[0];
  const issuesField = fieldNode.selectionSet?.selections.find(
    (sel) => sel.kind === "Field" && (sel.alias?.value ?? sel.name.value) === "issues"
  );
  const issuesSelection =
    issuesField && issuesField.kind === "Field" ? issuesField.selectionSet : undefined;
  if (!issuesSelection) {
    return `query AddIssueActivityRefetch($where: IssueWhere) { issues(where: $where) { id } }`;
  }

  // Collect every fragment reachable from the issues selection.
  const reachable = new Set<string>();
  const walk = (selectionSet: SelectionSetNode) => {
    for (const sel of selectionSet.selections) {
      if (sel.kind === "FragmentSpread") {
        if (!reachable.has(sel.name.value)) {
          reachable.add(sel.name.value);
          const frag = info.fragments[sel.name.value];
          if (frag) walk(frag.selectionSet);
        }
      } else if (sel.kind === "Field" || sel.kind === "InlineFragment") {
        if (sel.selectionSet) walk(sel.selectionSet);
      }
    }
  };
  walk(issuesSelection);

  const fragmentDefs = [...reachable]
    .map((name) => info.fragments[name])
    .filter((frag): frag is NonNullable<typeof frag> => Boolean(frag))
    .map((frag) => print(frag))
    .join("\n");

  return `query AddIssueActivityRefetch($where: IssueWhere) { issues(where: $where) ${print(
    issuesSelection
  )} }\n${fragmentDefs}`;
}

const getResolver = (deps: Input) => {
  const { driver } = deps;
  return async (_parent: unknown, args: Args, _context: GraphQLContext, info: GraphQLResolveInfo) => {
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
        const actionResult = await tx.run(CREATE_ACTION, params);
        const actionId = actionResult.records[0]?.get("actionId");
        if (params.commentText && actionId) {
          await tx.run(CREATE_MODERATED_COMMENT, { ...params, actionId });
        }
      });
    } finally {
      await session.close();
    }

    // Refetch with the caller's own selection. The caller has already passed the
    // moderation permission gate, so authorize the read as sensitive-eligible.
    const refetch = await executeGeneratedOperation<{ issues: unknown[] }>(
      driver,
      buildIssuesRefetchQuery(info),
      { where: { id: { eq: issueId } } },
      undefined,
      { mayAccessSensitiveContent: true }
    );
    return { issues: refetch.issues };
  };
};

export default getResolver;
