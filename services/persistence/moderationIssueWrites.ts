import neo4j, { type Driver, type ManagedTransaction } from "neo4j-driver";
import { DateTime } from "luxon";
import { issueTargetDefinitions } from "../issueTargetIdentity.js";

/**
 * FAMILY-3 / v7 owned moderation writes (campaign #284 — "recordModerationAction").
 *
 * @neo4j/graphql 7 removed nested connect/disconnect for to-one relationships,
 * so the moderation flows that create an Issue + ModerationAction + embedded
 * Comment (and wire their edges) no longer have a generated form. Per
 * docs/write-layer-strategy.md these relationship-heavy, authorization-critical
 * writes are owned here as parameterized Cypher run through the driver — atomic,
 * leader-routed (driver default, preserving read-your-own-writes), verified by
 * the integration suite rather than tsc.
 *
 * The capability has two primitives that the ~15 moderation repositories compose
 * (find-or-create is done by the caller, which already needs the found data):
 *   - createModerationIssue: Issue scalars + Author (ModerationProfile, AUTHORED_ISSUE)
 *     + optional Channel (HAS_ISSUE) + one edge per populated related* target
 *     (TARGETS_*, from the trusted issueTargetDefinitions map).
 *   - appendModerationActions: one or more ModerationAction nodes, each with an
 *     embedded root Comment, wiring PERFORMED_MODERATION_ACTION / MODERATED_COMMENT
 *     / AUTHORED_COMMENT / optional HAS_COMMENT / ACTIVITY_ON_ISSUE, plus the
 *     issue's isOpen / flaggedServerRuleViolation scalar updates — all in one
 *     write transaction so the 1-or-2 actions a flow emits commit together.
 *
 * Content-flag writes (archived/permanentlyRemoved), RelatedIssues/Suspension
 * links, and notifications stay in the callers — this module owns only the
 * Issue/Action/Comment graph.
 */

// The related* scalar fields an Issue can carry. Every one that is populated and
// maps to an issueTargetDefinition also gets its TARGETS_* edge.
export type IssueRelatedFields = {
  relatedCommentId?: string | null;
  relatedDiscussionId?: string | null;
  relatedEventId?: string | null;
  relatedWikiPageId?: string | null;
  relatedWikiRevisionId?: string | null;
  relatedImageId?: string | null;
  relatedAlbumId?: string | null;
  relatedChannelUniqueName?: string | null;
  relatedProfilePicUserId?: string | null;
  relatedUsername?: string | null;
  relatedModProfileName?: string | null;
  relatedChannelIconName?: string | null;
  relatedChannelBannerName?: string | null;
};

export type CreateModerationIssueParams = IssueRelatedFields & {
  issueNumber: number;
  title: string;
  body?: string | null;
  authorModName: string; // issue.authorName + AUTHORED_ISSUE to this ModerationProfile
  channelUniqueName?: string | null; // issue scalar; HAS_ISSUE connect only when present
  flaggedServerRuleViolation: boolean;
};

export type ModerationActionParams = {
  actionType: string;
  actionDescription: string;
  text?: string | null; // embedded comment text (already formatted; see formatModerationActionText)
  modDisplayName: string; // ModerationProfile for PERFORMED_MODERATION_ACTION + AUTHORED_COMMENT
  commentChannelUniqueName?: string | null; // HAS_COMMENT connect only when present
  idempotencyKey?: string | null;
  recommendedAction?: string | null;
  recommendationConfidence?: number | null;
  recommendationRationale?: string | null;
};

export type AppendModerationActionsParams = {
  issueId: string;
  actions: ModerationActionParams[];
  // Tri-state scalar updates: null/undefined leaves the issue's current value.
  isOpen?: boolean | null;
  flaggedServerRuleViolation?: boolean | null;
};

export type ModerationIssueRow = Record<string, unknown> & {
  id: string;
  issueNumber: number;
  flaggedServerRuleViolation?: boolean | null;
};

// Reproduces the embedded-comment text format of the former shared
// getModerationActionCreateInput: the body wrapped in blank lines, with an
// optional "Length of suspension" line for the suspend flow. Null text (e.g.
// close actions) stays null.
export const formatModerationActionText = (input: {
  text?: string | null;
  suspendUntil?: string;
  suspendIndefinitely?: boolean;
}): string | null => {
  const { text, suspendUntil, suspendIndefinitely } = input;
  if (!text) return null;
  const suspensionLine =
    suspendIndefinitely || suspendUntil
      ? `Length of suspension: ${
          suspendIndefinitely
            ? "Indefinite"
            : `Until ${
                suspendUntil
                  ? DateTime.fromISO(suspendUntil).toLocaleString(DateTime.DATE_FULL)
                  : "unknown date"
              }`
        }`
      : "";
  return `\n${text}\n${suspensionLine}\n`;
};

// Neo4j Integer -> number, temporal -> ISO string, matching how the generated
// projection serialized these so callers/tests see the same shapes.
const convertNeo4jValue = (value: unknown): unknown => {
  if (neo4j.isInt(value)) return (value as neo4j.Integer).toNumber();
  if (
    neo4j.isDateTime(value) ||
    neo4j.isLocalDateTime(value) ||
    neo4j.isDate(value) ||
    neo4j.isLocalTime(value) ||
    neo4j.isTime(value) ||
    neo4j.isDuration(value)
  ) {
    return (value as { toString(): string }).toString();
  }
  return value;
};

const toIssueRow = (properties: Record<string, unknown>): ModerationIssueRow => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) out[key] = convertNeo4jValue(value);
  return out as ModerationIssueRow;
};

const definitionsByField = new Map(issueTargetDefinitions.map((d) => [d.scalarField, d]));

/**
 * Create a moderation Issue with its Author, optional Channel, and a TARGETS_*
 * edge for every populated related* field. One statement; the Author/Channel/
 * target connects are best-effort (OPTIONAL MATCH + FOREACH) so a missing node
 * is skipped rather than failing the write.
 */
export async function createModerationIssue(
  driver: Driver,
  params: CreateModerationIssueParams
): Promise<ModerationIssueRow> {
  const {
    issueNumber,
    title,
    body,
    authorModName,
    channelUniqueName,
    flaggedServerRuleViolation,
    ...related
  } = params;

  // Scalars written with `SET i += $scalars` (null is allowed; undefined is not).
  const scalars: Record<string, unknown> = {
    title,
    authorName: authorModName,
    flaggedServerRuleViolation,
    channelUniqueName: channelUniqueName ?? null,
  };
  if (body !== undefined) scalars.body = body;
  const queryParams: Record<string, unknown> = { issueNumber, authorModName };
  if (channelUniqueName) queryParams.channelUniqueName = channelUniqueName;

  const targetClauses: string[] = [];
  for (const [field, value] of Object.entries(related) as [keyof IssueRelatedFields, unknown][]) {
    if (value === undefined || value === null || value === "") continue;
    scalars[field] = value;
    const def = definitionsByField.get(field);
    if (!def) continue; // relatedChannelIcon/Banner have no edge, scalar only
    const paramName = `target_${field}`;
    queryParams[paramName] = value;
    // Label and relationship type come from the trusted issueTargetDefinitions
    // constant (never user input), so interpolating them is safe.
    targetClauses.push(`
 WITH i
 OPTIONAL MATCH (${field}_t:${def.targetLabel} {${def.targetKey}: $${paramName}})
 FOREACH (_ IN CASE WHEN ${field}_t IS NULL THEN [] ELSE [1] END |
  MERGE (i)-[:${def.relationshipType}]->(${field}_t)
 )`);
  }
  queryParams.scalars = scalars;

  const channelClause = channelUniqueName
    ? `
 WITH i
 OPTIONAL MATCH (hostCh:Channel {uniqueName: $channelUniqueName})
 FOREACH (_ IN CASE WHEN hostCh IS NULL THEN [] ELSE [1] END |
  MERGE (hostCh)-[:HAS_ISSUE]->(i)
 )`
    : "";

  const cypher = `
 CREATE (i:Issue)
 SET i += $scalars
 SET i.id = randomUUID(), i.issueNumber = toInteger($issueNumber), i.isOpen = true,
     i.createdAt = datetime(), i.ageGateTouchedAt = datetime()
 WITH i
 OPTIONAL MATCH (author:ModerationProfile {displayName: $authorModName})
 FOREACH (_ IN CASE WHEN author IS NULL THEN [] ELSE [1] END |
  MERGE (i)-[:AUTHORED_ISSUE]->(author)
 )${channelClause}${targetClauses.join("")}
 RETURN i AS issue
`;

  const result = await driver.executeQuery(cypher, queryParams);
  const row = result.records[0];
  if (!row) throw new Error("Error creating moderation issue");
  return toIssueRow((row.get("issue") as { properties: Record<string, unknown> }).properties);
}

const buildAppendActionCypher = (action: ModerationActionParams): string => {
  const commentChannelClause = action.commentChannelUniqueName
    ? `
 WITH a, c
 OPTIONAL MATCH (commentCh:Channel {uniqueName: $commentChannelUniqueName})
 FOREACH (_ IN CASE WHEN commentCh IS NULL THEN [] ELSE [1] END |
  MERGE (commentCh)-[:HAS_COMMENT]->(c)
 )`
    : "";
  return `
 MATCH (i:Issue {id: $issueId})
 CREATE (a:ModerationAction {id: randomUUID(), actionType: $actionType, actionDescription: $actionDescription, createdAt: datetime()})
 SET a += $extras
 CREATE (i)-[:ACTIVITY_ON_ISSUE]->(a)
 CREATE (c:Comment {id: randomUUID(), text: $text, isRootComment: true, createdAt: datetime(), ageGateTouchedAt: datetime()})
 CREATE (a)-[:MODERATED_COMMENT]->(c)
 CREATE (c)-[:ACTIVITY_ON_ISSUE]->(i)
 WITH a, c
 OPTIONAL MATCH (mod:ModerationProfile {displayName: $modDisplayName})
 FOREACH (_ IN CASE WHEN mod IS NULL THEN [] ELSE [1] END |
  MERGE (mod)-[:PERFORMED_MODERATION_ACTION]->(a)
  MERGE (mod)-[:AUTHORED_COMMENT]->(c)
 )${commentChannelClause}
`;
};

const UPDATE_ISSUE_SCALARS = `
 MATCH (i:Issue {id: $issueId})
 SET i.ageGateTouchedAt = datetime()
 SET i.isOpen = CASE WHEN $isOpen IS NULL THEN i.isOpen ELSE $isOpen END
 SET i.flaggedServerRuleViolation = CASE WHEN $flagged IS NULL THEN i.flaggedServerRuleViolation ELSE $flagged END
 RETURN i AS issue
`;

/**
 * Append one or more moderation actions (each with its embedded Comment) to an
 * existing issue and apply the issue's scalar updates, all in one write
 * transaction. Returns the updated issue rows (empty if the issue was not found,
 * mirroring updateIssues matching nothing).
 */
export async function appendModerationActions(
  driver: Driver,
  params: AppendModerationActionsParams
): Promise<{ issues: ModerationIssueRow[] }> {
  const { issueId, actions, isOpen, flaggedServerRuleViolation } = params;
  const session = driver.session();
  try {
    const issues = await session.executeWrite(async (tx: ManagedTransaction) => {
      for (const action of actions) {
        const extras: Record<string, unknown> = {};
        if (action.idempotencyKey != null) extras.idempotencyKey = action.idempotencyKey;
        if (action.recommendedAction != null) extras.recommendedAction = action.recommendedAction;
        if (action.recommendationConfidence != null)
          extras.recommendationConfidence = action.recommendationConfidence;
        if (action.recommendationRationale != null)
          extras.recommendationRationale = action.recommendationRationale;
        await tx.run(buildAppendActionCypher(action), {
          issueId,
          actionType: action.actionType,
          actionDescription: action.actionDescription,
          text: action.text ?? null,
          modDisplayName: action.modDisplayName,
          commentChannelUniqueName: action.commentChannelUniqueName ?? null,
          extras,
        });
      }
      const res = await tx.run(UPDATE_ISSUE_SCALARS, {
        issueId,
        isOpen: isOpen ?? null,
        flagged: flaggedServerRuleViolation ?? null,
      });
      return res.records.map((r) =>
        toIssueRow((r.get("issue") as { properties: Record<string, unknown> }).properties)
      );
    });
    return { issues };
  } finally {
    await session.close();
  }
}
