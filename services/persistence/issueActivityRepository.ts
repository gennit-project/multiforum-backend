import type { Driver } from "neo4j-driver";
import type { IssueWhere, ModerationActionCreateInput } from "../../ogm_types.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";

export interface IssueActivityRepository {
  findRelatedIssueIds(where: IssueWhere): Promise<Array<{ id?: string }>>;
  appendActivity(issueId: string, node: ModerationActionCreateInput): Promise<void>;
}
const RELATED = `query ActivityRelatedIssues($where: IssueWhere) { issues(where: $where) { id } }`;
// Match the production reused-schema OGM default Issue projection, including its scalar failure contract.
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
const APPEND = `mutation AppendIssueActivity($where: IssueWhere, $update: IssueUpdateInput) {
  updateIssues(where: $where, update: $update) { issues ${ISSUE_ACTIVITY_DEFAULT_SELECTION} }
}`;
export function createIssueActivityRepository(driver: Driver): IssueActivityRepository {
  return {
    async findRelatedIssueIds(where) {
      const data = await executeGeneratedOperation<{ issues: Array<{id?: string}> }>(driver, RELATED, {where});
      return data.issues;
    },
    async appendActivity(issueId, node) {
      await executeGeneratedOperation(driver, APPEND, {
        where: {id: issueId}, update: {ActivityFeed: [{create: [{node}]}]},
      });
    },
  };
}
