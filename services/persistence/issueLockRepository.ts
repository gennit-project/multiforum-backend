import { rememberCanonicalSource } from '../canonicalSourceFields.js';
import neo4j, { type EagerResult, type Driver, type Node, type Record as Neo4jRecord } from "neo4j-driver";
import type { Issue } from "../../ogm_types.js";
import {
  appendModerationActions,
  type ModerationActionParams,
} from "./moderationIssueWrites.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";

// FAMILY-3 / v7 (campaign #284). Lock/unlock is owned Cypher: the Issue's
// ModerationAction + embedded Comment go through moderationIssueWrites, and the
// lock scalars plus the LockedBy edge (Issue.LockedBy = LOCKED_ISSUE, direction
// IN: (:ModerationProfile)-[:LOCKED_ISSUE]->(:Issue)) are written here. v7
// removed the nested to-one connect/disconnect that the generated IssueUpdateInput
// used to carry (and IssueUpdateInput no longer exposes LockedBy at all).
// Leader-routed via the driver default.
export type IssueLockWrite = {
  issueId: string;
  modDisplayName: string;
  lockedAt: string | null;
  lockReason: string | null;
  action: ModerationActionParams;
};

export type IssueLockSnapshot = Required<Pick<Issue, "id" | "issueNumber" | "channelUniqueName" | "locked">>;
// Only MATCH/SET-guaranteed properties are known; all unrelated persisted fields
// stay unknown and retain outer GraphQL's selected-field serialization.
type WrittenIssueProperties = Record<string, unknown> & {id:string;locked:boolean;lockedAt?:neo4j.DateTime;lockReason?:string};
type WrittenIssueRecord = {issue:Node<neo4j.Integer,WrittenIssueProperties>};
export type IssueLockResult = Record<string,unknown> & {id:string;locked:boolean;lockedAt?:string;lockReason?:string};
export interface IssueLockRepository {
  findLockState(id: string): Promise<IssueLockSnapshot[]>;
  lockIssue(params: IssueLockWrite): Promise<{ issues: IssueLockResult[] }>;
  unlockIssue(params: IssueLockWrite): Promise<{ issues: IssueLockResult[] }>;
}

const FIND = `query IssueLockState($where: IssueWhere!) {
  issues(where: $where) { id issueNumber channelUniqueName locked }
}`;

const convertNeo4jValue = (value: unknown): unknown => {
  if (neo4j.isInt(value)) return value.toNumber();
  if (
    neo4j.isDateTime(value) ||
    neo4j.isLocalDateTime(value) ||
    neo4j.isDate(value) ||
    neo4j.isLocalTime(value) ||
    neo4j.isTime(value) ||
    neo4j.isDuration(value)
  ) {
    return value.toString();
  }
  return value;
};

const toIssueRow = (properties: WrittenIssueProperties): IssueLockResult => {
  const out: IssueLockResult = {id:properties.id,locked:properties.locked};
  for (const [key, value] of Object.entries(properties)) {
    if (key === "id" || key === "locked") continue;
    if (key === "lockedAt") out.lockedAt = properties.lockedAt?.toString();
    else if (key === "lockReason") out.lockReason = properties.lockReason;
    else out[key] = convertNeo4jValue(value);
  }
  return rememberCanonicalSource(out);
};

const LOCK_SCALARS = `
 MATCH (i:Issue {id: $issueId})
 SET i.locked = true,
     i.lockedAt = CASE WHEN $lockedAt IS NULL THEN null ELSE datetime($lockedAt) END,
     i.lockReason = $lockReason,
     i.ageGateTouchedAt = datetime()
 WITH i
 OPTIONAL MATCH (mod:ModerationProfile {displayName: $modDisplayName})
 FOREACH (_ IN CASE WHEN mod IS NULL THEN [] ELSE [1] END |
  MERGE (mod)-[:LOCKED_ISSUE]->(i)
 )
 RETURN i AS issue
`;

const UNLOCK_SCALARS = `
 MATCH (i:Issue {id: $issueId})
 SET i.locked = false, i.lockedAt = null, i.lockReason = null, i.ageGateTouchedAt = datetime()
 WITH i
 OPTIONAL MATCH (i)<-[r:LOCKED_ISSUE]-(:ModerationProfile)
 FOREACH (rel IN CASE WHEN r IS NULL THEN [] ELSE [r] END | DELETE rel)
 RETURN i AS issue
`;

export function createIssueLockRepository(driver: Driver): IssueLockRepository {
  const toRows = (records: Array<Neo4jRecord<WrittenIssueRecord>>): IssueLockResult[] =>
    records.map((r) => toIssueRow(r.get("issue").properties));
  return {
    async findLockState(id) {
      const result = await executeGeneratedOperation<{ issues: IssueLockSnapshot[] }>(driver, FIND, { where: { id: { eq: id } } });
      return result.issues;
    },
    async lockIssue(params) {
      // Action + embedded comment graph via the owned moderation write, then the
      // lock scalars + LockedBy edge.
      await appendModerationActions(driver, { issueId: params.issueId, actions: [params.action] });
      const result = await driver.executeQuery<EagerResult<WrittenIssueRecord>>(LOCK_SCALARS, {
        issueId: params.issueId,
        lockedAt: params.lockedAt,
        lockReason: params.lockReason,
        modDisplayName: params.modDisplayName,
      });
      return { issues: toRows(result.records) };
    },
    async unlockIssue(params) {
      await appendModerationActions(driver, { issueId: params.issueId, actions: [params.action] });
      const result = await driver.executeQuery<EagerResult<WrittenIssueRecord>>(UNLOCK_SCALARS, { issueId: params.issueId });
      return { issues: toRows(result.records) };
    },
  };
}
