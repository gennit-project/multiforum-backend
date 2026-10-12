import { GraphQLError } from "graphql";
import neo4j, { type Driver } from "neo4j-driver";

/**
 * Maximum number of IS_REPLY_TO relationships between a comment and its root.
 * Root comments have depth 0; a direct reply has depth 1.
 */
export const MAX_REPLY_DEPTH = 32;
export const REPLY_ANCESTRY_ERROR_CODE = "INVALID_REPLY_ANCESTRY";

type AssertReplyRelationshipInput = {
  driver: Driver;
  parentCommentId: string;
  childCommentId?: string | null;
  allowParentReplacement?: boolean;
};

type ReplyAncestrySnapshot = {
  parentDepth: number;
  parentHasCycle: boolean;
  parentExceedsMaxDepth: boolean;
  ancestryHasMultipleParents: boolean;
  wouldCreateCycle: boolean;
  currentParentIds: string[];
};

const replyError = (message: string): GraphQLError =>
  new GraphQLError(message, {
    extensions: { code: REPLY_ANCESTRY_ERROR_CODE },
  });

const toNumber = (value: unknown): number =>
  neo4j.isInt(value) ? value.toNumber() : Number(value ?? 0);

/**
 * Validate the final edge before a comment is connected to a parent. The
 * query is deliberately bounded one hop beyond the supported limit: that is
 * enough to distinguish a valid maximum-depth chain from an existing
 * over-depth or cyclic chain without ever performing an unbounded traversal.
 */
export async function assertReplyRelationship({
  driver,
  parentCommentId,
  childCommentId,
  allowParentReplacement = false,
}: AssertReplyRelationshipInput): Promise<void> {
  if (!parentCommentId) {
    throw replyError("A reply parent ID is required.");
  }
  if (childCommentId && childCommentId === parentCommentId) {
    throw replyError("A comment cannot reply to itself.");
  }

  const session = driver.session();
  try {
    const result = await session.executeRead((tx) => tx.run(
      `
      MATCH (parent:Comment {id: $parentCommentId})
      OPTIONAL MATCH ancestry = (parent)-[:IS_REPLY_TO*0..${MAX_REPLY_DEPTH}]->(ancestor:Comment)
      WITH parent, max(length(ancestry)) AS parentDepth
      OPTIONAL MATCH (child:Comment {id: $childCommentId})-[:IS_REPLY_TO]->(currentParent:Comment)
      RETURN parentDepth,
        EXISTS {
          MATCH (parent)-[:IS_REPLY_TO*1..${MAX_REPLY_DEPTH + 1}]->(parent)
        } AS parentHasCycle,
        EXISTS {
          MATCH (parent)-[:IS_REPLY_TO*${MAX_REPLY_DEPTH + 1}]->(:Comment)
        } AS parentExceedsMaxDepth,
        EXISTS {
          MATCH (parent)-[:IS_REPLY_TO*0..${MAX_REPLY_DEPTH}]->(chainComment:Comment)
          WHERE count { (chainComment)-[:IS_REPLY_TO]->(:Comment) } > 1
        } AS ancestryHasMultipleParents,
        CASE WHEN $childCommentId IS NULL THEN false ELSE EXISTS {
          MATCH (parent)-[:IS_REPLY_TO*1..${MAX_REPLY_DEPTH + 1}]->(:Comment {id: $childCommentId})
        } END AS wouldCreateCycle,
        collect(DISTINCT currentParent.id) AS currentParentIds
      `,
      { parentCommentId, childCommentId: childCommentId ?? null }
    ));

    const record = result.records[0];
    if (!record) {
      throw replyError("Could not find the comment being replied to.");
    }

    const snapshot: ReplyAncestrySnapshot = {
      parentDepth: toNumber(record.get("parentDepth")),
      parentHasCycle: record.get("parentHasCycle") === true,
      parentExceedsMaxDepth: record.get("parentExceedsMaxDepth") === true,
      ancestryHasMultipleParents:
        record.get("ancestryHasMultipleParents") === true,
      wouldCreateCycle: record.get("wouldCreateCycle") === true,
      currentParentIds: (record.get("currentParentIds") as Array<string | null>)
        .filter((id): id is string => typeof id === "string"),
    };

    if (snapshot.parentHasCycle || snapshot.parentExceedsMaxDepth) {
      throw replyError("The selected reply parent has an invalid ancestry chain.");
    }
    if (snapshot.ancestryHasMultipleParents) {
      throw replyError("The selected reply parent belongs to a thread with multiple parents.");
    }
    if (snapshot.parentDepth >= MAX_REPLY_DEPTH) {
      throw replyError(
        `Replies cannot be nested more than ${MAX_REPLY_DEPTH} levels deep.`
      );
    }
    if (snapshot.wouldCreateCycle) {
      throw replyError("This reply relationship would create a cycle.");
    }
    if (snapshot.currentParentIds.length > 1) {
      throw replyError("A comment cannot have multiple reply parents.");
    }
    const existingParentId = snapshot.currentParentIds[0];
    if (
      existingParentId &&
      existingParentId !== parentCommentId &&
      !allowParentReplacement
    ) {
      throw replyError(
        "The comment already has a reply parent; disconnect or overwrite it before reparenting."
      );
    }
  } finally {
    await session.close();
  }
}
