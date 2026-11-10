import type { SiteWideIssueListItem, QueryResolvers } from '../../src/generated/graphql.js';
import type { GraphQLContext } from '../../types/context.js';
import type { Selection } from './selection.js';
import type { RawSelectedResolver } from './rawSelectedSource.js';
export const siteWideIssueItemSelection = {
  id: true,
  issueNumber: true,
  title: true,
  body: true,
  isOpen: true,
  createdAt: true,
  updatedAt: true,
  relatedCommentId: true,
  relatedDiscussionId: true,
  relatedEventId: true,
  relatedImageId: true,
  relatedWikiPageId: true,
  relatedWikiRevisionId: true,
  relatedUsername: true,
  flaggedServerRuleViolation: true,
  locked: true,
  lockReason: true,
  channelUniqueName: true,
  channelIconURL: true,
  authorName: true,
  reportCount: true,
} as const satisfies Selection<SiteWideIssueListItem>;
export type SiteWideIssueItemContract = RawSelectedResolver<QueryResolvers<GraphQLContext>['getSiteWideIssueList'], {aggregateIssueCount:true; issues:typeof siteWideIssueItemSelection}>;
