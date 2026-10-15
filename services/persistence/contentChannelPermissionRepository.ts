import neo4j, { type Driver } from "neo4j-driver";
import { resolveNeo4jDatabase } from "../neo4jDatabase.js";

export type ContentChannelLookup = {
  found: boolean;
  channelUniqueNames: string[];
};

export interface ContentChannelPermissionRepository {
  findCommentChannels(commentIds: string[]): Promise<ContentChannelLookup>;
  findDiscussionChannels(discussionIds: string[]): Promise<ContentChannelLookup>;
  findEventChannels(eventIds: string[]): Promise<ContentChannelLookup>;
}

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
  };
};
