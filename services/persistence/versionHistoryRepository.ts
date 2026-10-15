import neo4j, { type Driver, type ManagedTransaction } from "neo4j-driver";
import { resolveNeo4jDatabase } from "../neo4jDatabase.js";

export type VersionTarget =
  | "comment"
  | "discussion-title"
  | "discussion-body"
  | "wiki-page";

export type RecordTextVersionInput = {
  target: VersionTarget;
  parentId: string;
  body: string;
  username: string;
  editReason?: string | null;
};

export interface VersionHistoryRepository {
  getCommentAuthorName(commentId: string): Promise<string | null>;
  getDiscussionAuthorUsername(discussionId: string): Promise<string | null>;
  getWikiPageVersionAuthorUsername(wikiPageId: string): Promise<string | null>;
  recordTextVersion(input: RecordTextVersionInput): Promise<string | null>;
}

export const GET_COMMENT_AUTHOR_NAME_QUERY = `
  MATCH (comment:Comment {id: $commentId})
  OPTIONAL MATCH (user:User)-[:AUTHORED_COMMENT]->(comment)
  OPTIONAL MATCH (moderationProfile:ModerationProfile)-[:AUTHORED_COMMENT]->(comment)
  RETURN coalesce(user.username, moderationProfile.displayName) AS username
  LIMIT 1
`;

export const GET_DISCUSSION_AUTHOR_USERNAME_QUERY = `
  MATCH (author:User)-[:POSTED_DISCUSSION]->(discussion:Discussion {id: $discussionId})
  RETURN author.username AS username
  LIMIT 1
`;

export const GET_WIKI_PAGE_VERSION_AUTHOR_USERNAME_QUERY = `
  MATCH (author:User)-[:AUTHORED_VERSION]->(wikiPage:WikiPage {id: $wikiPageId})
  RETURN author.username AS username
  LIMIT 1
`;

const createRecordTextVersionQuery = (
  parentLabel: "Comment" | "Discussion" | "WikiPage",
  relationshipType: "HAS_VERSION" | "HAS_TITLE_VERSION" | "HAS_BODY_VERSION"
) => `
  MATCH (parent:${parentLabel} {id: $parentId})
  MATCH (author:User {username: $username})
  CREATE (version:TextVersion {
    id: randomUUID(),
    body: $body,
    editReason: $editReason,
    createdAt: datetime(),
    ageGateTouchedAt: datetime()
  })
  CREATE (author)-[:AUTHORED_VERSION]->(version)
  CREATE (parent)-[:${relationshipType}]->(version)
  RETURN version.id AS id
`;

export const RECORD_TEXT_VERSION_QUERIES: Record<VersionTarget, string> = {
  comment: createRecordTextVersionQuery("Comment", "HAS_VERSION"),
  "discussion-title": createRecordTextVersionQuery(
    "Discussion",
    "HAS_TITLE_VERSION"
  ),
  "discussion-body": createRecordTextVersionQuery(
    "Discussion",
    "HAS_BODY_VERSION"
  ),
  "wiki-page": createRecordTextVersionQuery("WikiPage", "HAS_VERSION"),
};

const getUsername = async (
  driver: Driver,
  database: string,
  query: string,
  parameters: Record<string, string>
): Promise<string | null> => {
  // These background reads intentionally stay leader-routed so an update event
  // can immediately observe the author relationship created by the write.
  const session = driver.session({
    database,
    defaultAccessMode: neo4j.session.WRITE,
  });
  try {
    const result = await session.run(query, parameters);
    return result.records[0]?.get("username") ?? null;
  } finally {
    await session.close();
  }
};

const recordTextVersionInTransaction = async (
  transaction: ManagedTransaction,
  input: RecordTextVersionInput
): Promise<string | null> => {
  const result = await transaction.run(RECORD_TEXT_VERSION_QUERIES[input.target], {
    parentId: input.parentId,
    body: input.body,
    username: input.username,
    editReason: input.editReason || null,
  });
  return result.records[0]?.get("id") ?? null;
};

export const createVersionHistoryRepository = (
  driver: Driver,
  database = resolveNeo4jDatabase()
): VersionHistoryRepository => ({
  getCommentAuthorName(commentId) {
    return getUsername(driver, database, GET_COMMENT_AUTHOR_NAME_QUERY, {
      commentId,
    });
  },

  getDiscussionAuthorUsername(discussionId) {
    return getUsername(driver, database, GET_DISCUSSION_AUTHOR_USERNAME_QUERY, {
      discussionId,
    });
  },

  getWikiPageVersionAuthorUsername(wikiPageId) {
    return getUsername(
      driver,
      database,
      GET_WIKI_PAGE_VERSION_AUTHOR_USERNAME_QUERY,
      { wikiPageId }
    );
  },

  async recordTextVersion(input) {
    if (!input.body || !input.username) {
      return null;
    }

    const session = driver.session({
      database,
      defaultAccessMode: neo4j.session.WRITE,
    });
    try {
      return await session.executeWrite((transaction) =>
        recordTextVersionInTransaction(transaction, input)
      );
    } finally {
      await session.close();
    }
  },
});
