import type { Driver } from "neo4j-driver";
import type { IssueWhere } from "../../ogm_types.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";

// FAMILY-3 / v7 (campaign #284). A moderation activity connects an existing actor
// (ModerationProfile or User via PERFORMED_MODERATION_ACTION), and optionally an
// existing moderated Comment (MODERATED_COMMENT) and Revision (HAS_REVISION) —
// all to-one relationships whose nested connect v7 removed — so appendActivity is
// owned Cypher. The caller still assembles the familiar create shape; the owned
// write reads the connected identifiers out of it.
export type ModerationActivityNode = {
  actionType?: string | null;
  actionDescription?: string | null;
  ModerationProfile?: { connect?: { where?: { node?: { displayName?: string | null } | null } | null } | null } | null;
  User?: { connect?: { where?: { node?: { username?: string | null } | null } | null } | null } | null;
  Comment?: { connect?: { where?: { node?: { id?: string | null } | null } | null } | null } | null;
  Revision?: { connect?: { where?: { node?: { id?: string | null } | null } | null } | null } | null;
};

export interface IssueActivityRepository {
  findRelatedIssueIds(where: IssueWhere): Promise<Array<{ id?: string }>>;
  appendActivity(issueId: string, node: ModerationActivityNode): Promise<void>;
}
const RELATED = `query ActivityRelatedIssues($where: IssueWhere) { issues(where: $where) { id } }`;

// The generated Issue default projection (used by issueActivityMiddlewareRepository
// for its close mutation). Kept here as the shared selection.
export const ISSUE_ACTIVITY_DEFAULT_SELECTION = `{
  id
  issueNumber
  channelUniqueName
  authorName
  title
  body
  isOpen
  relatedDiscussionId
  relatedCommentId
  relatedEventId
  relatedWikiPageId
  relatedWikiRevisionId
  relatedUsername
  relatedModProfileName
  relatedChannelUniqueName
  relatedImageId
  relatedAlbumId
  relatedProfilePicUserId
  relatedChannelIconName
  relatedChannelBannerName
  flaggedServerRuleViolation
  locked
  lockReason
  createdAt
  updatedAt
  lockedAt
}`;

const APPEND = `
 MATCH (i:Issue {id: $issueId})
 CREATE (a:ModerationAction {id: randomUUID(), actionType: $actionType, actionDescription: $actionDescription, createdAt: datetime()})
 CREATE (i)-[:ACTIVITY_ON_ISSUE]->(a)
 WITH a
 OPTIONAL MATCH (mod:ModerationProfile {displayName: $modProfileName})
 FOREACH (_ IN CASE WHEN mod IS NULL THEN [] ELSE [1] END | MERGE (mod)-[:PERFORMED_MODERATION_ACTION]->(a))
 WITH a
 OPTIONAL MATCH (u:User {username: $username})
 FOREACH (_ IN CASE WHEN u IS NULL THEN [] ELSE [1] END | MERGE (u)-[:PERFORMED_MODERATION_ACTION]->(a))
 WITH a
 OPTIONAL MATCH (c:Comment {id: $commentId})
 FOREACH (_ IN CASE WHEN c IS NULL THEN [] ELSE [1] END | MERGE (a)-[:MODERATED_COMMENT]->(c))
 WITH a
 OPTIONAL MATCH (rev:TextVersion {id: $revisionId})
 FOREACH (_ IN CASE WHEN rev IS NULL THEN [] ELSE [1] END | MERGE (a)-[:HAS_REVISION]->(rev))
`;

export function createIssueActivityRepository(driver: Driver): IssueActivityRepository {
  return {
    async findRelatedIssueIds(where) {
      const data = await executeGeneratedOperation<{ issues: Array<{id?: string}> }>(driver, RELATED, {where});
      return data.issues;
    },
    async appendActivity(issueId, node) {
      await driver.executeQuery(APPEND, {
        issueId,
        actionType: node.actionType ?? null,
        actionDescription: node.actionDescription ?? null,
        modProfileName: node.ModerationProfile?.connect?.where?.node?.displayName ?? null,
        username: node.User?.connect?.where?.node?.username ?? null,
        commentId: node.Comment?.connect?.where?.node?.id ?? null,
        revisionId: node.Revision?.connect?.where?.node?.id ?? null,
      });
    },
  };
}
