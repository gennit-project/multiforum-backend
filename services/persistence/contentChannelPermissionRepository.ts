import neo4j, { type Driver } from "neo4j-driver";
import { resolveNeo4jDatabase } from "../neo4jDatabase.js";

export type ContentChannelLookup = {
  found: boolean;
  channelUniqueNames: string[];
};

export type IssueChannelLookup = {
  found: boolean;
  channelUniqueName: string | null;
};

export type CommentChannelReferences = {
  found: boolean;
  discussionChannelUniqueName: string | null;
  directChannelUniqueName: string | null;
};

export type DiscussionChannelReference = {
  found: boolean;
  channelUniqueName: string | null;
};

export interface ContentChannelPermissionRepository {
  findCommentChannels(commentIds: string[]): Promise<ContentChannelLookup>;
  findDiscussionChannels(discussionIds: string[]): Promise<ContentChannelLookup>;
  findEventChannels(eventIds: string[]): Promise<ContentChannelLookup>;
  findIssueChannel(issueId: string): Promise<IssueChannelLookup>;
  findCommentChannelReferences(
    commentId: string
  ): Promise<CommentChannelReferences>;
  findDiscussionChannelReference(
    discussionChannelId: string
  ): Promise<DiscussionChannelReference>;
}

export const FIND_ISSUE_CHANNEL_QUERY = `
  MATCH (issue:Issue {id: $id})
  RETURN issue.channelUniqueName AS channelUniqueName
  LIMIT 1
`;

export const FIND_COMMENT_CHANNEL_REFERENCES_QUERY = `
  OPTIONAL MATCH (comment:Comment {id: $id})
  OPTIONAL MATCH (comment)<-[:CONTAINS_COMMENT]-(discussionEntry:DiscussionChannel)
  OPTIONAL MATCH (comment)<-[:HAS_COMMENT]-(channel:Channel)
  RETURN count(DISTINCT comment) > 0 AS found,
         head(collect(DISTINCT discussionEntry.channelUniqueName)) AS discussionChannelUniqueName,
         head(collect(DISTINCT channel.uniqueName)) AS directChannelUniqueName
`;

export const FIND_DISCUSSION_CHANNEL_REFERENCE_QUERY = `
  MATCH (entry:DiscussionChannel {id: $id})
  RETURN entry.channelUniqueName AS channelUniqueName
  LIMIT 1
`;

export const FIND_COMMENT_CHANNELS_QUERY = `
  MATCH (comment:Comment)
  WHERE comment.id IN $ids
  WITH collect(comment) AS comments
  RETURN size(comments) > 0 AS found,
         reduce(channelNames = [], comment IN comments |
           channelNames
           + [(comment)<-[:HAS_COMMENT]-(channel:Channel) | channel.uniqueName]
           + [(comment)<-[:CONTAINS_COMMENT]-(entry:DiscussionChannel) | entry.channelUniqueName]
           + [(comment)<-[:HAS_COMMENT]-(event:Event)<-[:POSTED_IN_CHANNEL]-(entry:EventChannel) | entry.channelUniqueName]
           + [(comment)-[:ACTIVITY_ON_ISSUE]->(issue:Issue) | issue.channelUniqueName]
         ) AS channelUniqueNames
`;

export const FIND_DISCUSSION_CHANNELS_QUERY = `
  MATCH (discussion:Discussion)
  WHERE discussion.id IN $ids
  WITH collect(discussion) AS discussions
  RETURN size(discussions) > 0 AS found,
         reduce(channelNames = [], discussion IN discussions |
           channelNames
           + [(discussion)<-[:POSTED_IN_CHANNEL]-(entry:DiscussionChannel) | entry.channelUniqueName]
         ) AS channelUniqueNames
`;

export const FIND_EVENT_CHANNELS_QUERY = `
  MATCH (event:Event)
  WHERE event.id IN $ids
  WITH collect(event) AS events
  RETURN size(events) > 0 AS found,
         reduce(channelNames = [], event IN events |
           channelNames
           + [(event)<-[:POSTED_IN_CHANNEL]-(entry:EventChannel) | entry.channelUniqueName]
         ) AS channelUniqueNames
`;

const normalizeChannelNames = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))
  );
};

const normalizeChannelName = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

export const createContentChannelPermissionRepository = (
  driver: Driver,
  database = resolveNeo4jDatabase()
): ContentChannelPermissionRepository => {
  const findChannels = async (
    query: string,
    ids: string[]
  ): Promise<ContentChannelLookup> => {
    if (ids.length === 0) {
      return { found: false, channelUniqueNames: [] };
    }

    // Authorization reads stay leader-routed. The request-scoped driver wrapper
    // supplies the current bookmark manager so a mutation can observe prior
    // writes in the same causal chain.
    const session = driver.session({
      database,
      defaultAccessMode: neo4j.session.WRITE,
    });
    try {
      const result = await session.run(query, { ids });
      const record = result.records[0];
      return {
        found: record?.get("found") === true,
        channelUniqueNames: normalizeChannelNames(
          record?.get("channelUniqueNames")
        ),
      };
    } finally {
      await session.close();
    }
  };

  const runSingleLookup = async <T>(
    query: string,
    id: string,
    missing: T,
    mapRecord: (record: { get(key: string): unknown }) => T
  ): Promise<T> => {
    const session = driver.session({
      database,
      defaultAccessMode: neo4j.session.WRITE,
    });
    try {
      const result = await session.run(query, { id });
      const record = result.records[0];
      return record ? mapRecord(record) : missing;
    } finally {
      await session.close();
    }
  };

  return {
    findCommentChannels(commentIds) {
      return findChannels(FIND_COMMENT_CHANNELS_QUERY, commentIds);
    },

    findDiscussionChannels(discussionIds) {
      return findChannels(FIND_DISCUSSION_CHANNELS_QUERY, discussionIds);
    },

    findEventChannels(eventIds) {
      return findChannels(FIND_EVENT_CHANNELS_QUERY, eventIds);
    },

    findIssueChannel(issueId) {
      return runSingleLookup<IssueChannelLookup>(
        FIND_ISSUE_CHANNEL_QUERY,
        issueId,
        { found: false, channelUniqueName: null },
        (record) => ({
          found: true,
          channelUniqueName: normalizeChannelName(record.get("channelUniqueName")),
        })
      );
    },

    findCommentChannelReferences(commentId) {
      return runSingleLookup<CommentChannelReferences>(
        FIND_COMMENT_CHANNEL_REFERENCES_QUERY,
        commentId,
        {
          found: false,
          discussionChannelUniqueName: null,
          directChannelUniqueName: null,
        },
        (record) => ({
          found: record.get("found") === true,
          discussionChannelUniqueName: normalizeChannelName(
            record.get("discussionChannelUniqueName")
          ),
          directChannelUniqueName: normalizeChannelName(
            record.get("directChannelUniqueName")
          ),
        })
      );
    },

    findDiscussionChannelReference(discussionChannelId) {
      return runSingleLookup<DiscussionChannelReference>(
        FIND_DISCUSSION_CHANNEL_REFERENCE_QUERY,
        discussionChannelId,
        { found: false, channelUniqueName: null },
        (record) => ({
          found: true,
          channelUniqueName: normalizeChannelName(record.get("channelUniqueName")),
        })
      );
    },
  };
};

export const resolveContentChannelPermissionRepository = (context: {
  contentChannelPermissionRepository?: ContentChannelPermissionRepository;
  driver: Driver;
}): ContentChannelPermissionRepository =>
  context.contentChannelPermissionRepository ??
  createContentChannelPermissionRepository(context.driver);
