import neo4j, { type Driver } from "neo4j-driver";
import { resolveNeo4jDatabase } from "../neo4jDatabase.js";

export type ParentCommentState = {
  found: boolean;
  archived: boolean | null;
};

export type CommentTargetState = {
  found: boolean;
  locked: boolean | null;
  archived: boolean | null;
};

export type DiscussionCommentTargetState = CommentTargetState & {
  channelUniqueName: string | null;
};

export interface CommentCreationAuthorizationRepository {
  findParentCommentState(commentId: string): Promise<ParentCommentState>;
  findDiscussionChannelState(
    discussionChannelId: string
  ): Promise<DiscussionCommentTargetState>;
  findEventChannelState(
    eventId: string,
    channelUniqueName: string
  ): Promise<CommentTargetState>;
}

export const FIND_PARENT_COMMENT_STATE_QUERY = `
  MATCH (comment:Comment {id: $commentId})
  RETURN comment.archived AS archived
  LIMIT 1
`;

export const FIND_DISCUSSION_CHANNEL_STATE_QUERY = `
  MATCH (entry:DiscussionChannel {id: $discussionChannelId})
  RETURN entry.channelUniqueName AS channelUniqueName,
         entry.locked AS locked,
         entry.archived AS archived
  LIMIT 1
`;

export const FIND_EVENT_CHANNEL_STATE_QUERY = `
  MATCH (entry:EventChannel {
    eventId: $eventId,
    channelUniqueName: $channelUniqueName
  })
  RETURN entry.locked AS locked,
         entry.archived AS archived
  LIMIT 1
`;

const normalizeBoolean = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

const normalizeChannelName = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

export const createCommentCreationAuthorizationRepository = (
  driver: Driver,
  database = resolveNeo4jDatabase()
): CommentCreationAuthorizationRepository => {
  const runSingleLookup = async <T>(
    query: string,
    parameters: Record<string, string>,
    missing: T,
    mapRecord: (record: { get(key: string): unknown }) => T
  ): Promise<T> => {
    // Authorization reads stay leader-routed. The request-scoped driver wrapper
    // supplies the current bookmark manager for read-your-own-writes behavior.
    const session = driver.session({
      database,
      defaultAccessMode: neo4j.session.WRITE,
    });
    try {
      const result = await session.run(query, parameters);
      const record = result.records[0];
      return record ? mapRecord(record) : missing;
    } finally {
      await session.close();
    }
  };

  return {
    findParentCommentState(commentId) {
      return runSingleLookup<ParentCommentState>(
        FIND_PARENT_COMMENT_STATE_QUERY,
        { commentId },
        { found: false, archived: null },
        (record) => ({
          found: true,
          archived: normalizeBoolean(record.get("archived")),
        })
      );
    },

    findDiscussionChannelState(discussionChannelId) {
      return runSingleLookup<DiscussionCommentTargetState>(
        FIND_DISCUSSION_CHANNEL_STATE_QUERY,
        { discussionChannelId },
        {
          found: false,
          channelUniqueName: null,
          locked: null,
          archived: null,
        },
        (record) => ({
          found: true,
          channelUniqueName: normalizeChannelName(
            record.get("channelUniqueName")
          ),
          locked: normalizeBoolean(record.get("locked")),
          archived: normalizeBoolean(record.get("archived")),
        })
      );
    },

    findEventChannelState(eventId, channelUniqueName) {
      return runSingleLookup<CommentTargetState>(
        FIND_EVENT_CHANNEL_STATE_QUERY,
        { eventId, channelUniqueName },
        { found: false, locked: null, archived: null },
        (record) => ({
          found: true,
          locked: normalizeBoolean(record.get("locked")),
          archived: normalizeBoolean(record.get("archived")),
        })
      );
    },
  };
};

export const resolveCommentCreationAuthorizationRepository = (context: {
  commentCreationAuthorizationRepository?: CommentCreationAuthorizationRepository;
  driver: Driver;
}): CommentCreationAuthorizationRepository =>
  context.commentCreationAuthorizationRepository ??
  createCommentCreationAuthorizationRepository(context.driver);
