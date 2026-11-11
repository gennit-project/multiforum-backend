import type { Integer } from 'neo4j-driver';
/** Exact Cypher map; stored scalars are deliberately untrusted. */
export type SiteWideIssueProjection = {
  id: unknown;
  issueNumber: unknown;
  title: unknown;
  body: unknown;
  isOpen: unknown;
  createdAt: string | null;
  updatedAt: string | null;
  relatedCommentId: unknown;
  relatedDiscussionId: unknown;
  relatedEventId: unknown;
  relatedImageId: unknown;
  relatedWikiPageId: unknown;
  relatedWikiRevisionId: unknown;
  relatedUsername: unknown;
  flaggedServerRuleViolation: unknown;
  locked: unknown;
  lockReason: unknown;
  channelUniqueName: unknown;
  channelIconURL: unknown;
  authorName: unknown;
  reportCount: Integer | number;
};
