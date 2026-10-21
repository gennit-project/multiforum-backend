import type { Driver } from "neo4j-driver";
import type { Issue, IssueUpdateInput } from "../../ogm_types.js";
import { assertIssueIdentityUpdateAllowed } from "../issueTargetIdentity.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";

export interface IssueLockRepository {
  findLockState(id: string): Promise<Pick<Issue, "id" | "issueNumber" | "channelUniqueName" | "locked">[]>;
  updateLock(id: string, update: IssueUpdateInput): Promise<{ issues: Issue[] }>;
}
const FIND = `query IssueLockState($where: IssueWhere!) {
  issues(where: $where) { id issueNumber channelUniqueName locked }
}`;
const UPDATE = `mutation UpdateIssueLock($where: IssueWhere!, $update: IssueUpdateInput!) {
 updateIssues(where: $where, update: $update) {
          issues {
            id
            issueNumber
            title
            body
            channelUniqueName
            isOpen
            createdAt
            updatedAt
            relatedCommentId
            relatedDiscussionId
            relatedEventId
            flaggedServerRuleViolation
            locked
            lockedAt
            lockReason
            LockedBy {
              displayName
            }
            SubscribedToNotifications {
              username
            }
            ActivityFeed {
              id
              actionType
              actionDescription
              createdAt
              ModerationProfile {
                displayName
              }
            }
          }
        }
}`;
export function createIssueLockRepository(driver: Driver): IssueLockRepository {
  return {
    async findLockState(id) {
      const result = await executeGeneratedOperation<{issues: Issue[]}>(driver, FIND, {where: {id}});
      return result.issues;
    },
    async updateLock(id, update) {
      assertIssueIdentityUpdateAllowed(update);
      const result = await executeGeneratedOperation<{updateIssues: {issues: Issue[]}}>(driver, UPDATE, {where: {id}, update});
      return result.updateIssues;
    },
  };
}
