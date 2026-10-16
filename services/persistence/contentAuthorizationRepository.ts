import neo4j, { type Driver } from "neo4j-driver";
import { resolveNeo4jDatabase } from "../neo4jDatabase.js";

export type UserOwnershipRecord = {
  id: string;
  username: string | null;
};

export type ActorIdentity = {
  username: string | null;
  displayName: string | null;
};

export type ActorAuthorizationRecord = {
  found: boolean;
  actor: ActorIdentity | null;
};

export type UserAuthorizationRecord = {
  found: boolean;
  username: string | null;
};

export type IssueLockRecord = {
  found: boolean;
  locked: boolean | null;
};

export interface ContentAuthorizationRepository {
  findAlbumOwners(ids: string[]): Promise<UserOwnershipRecord[]>;
  findCollectionOwners(ids: string[]): Promise<UserOwnershipRecord[]>;
  findCommentAuthor(id: string): Promise<ActorAuthorizationRecord>;
  findDiscussionAuthor(id: string): Promise<UserAuthorizationRecord>;
  findEventPoster(id: string): Promise<UserAuthorizationRecord>;
  findImageUploader(id: string): Promise<UserAuthorizationRecord>;
  findIssueAuthor(id: string): Promise<ActorAuthorizationRecord>;
  findIssueLock(id: string): Promise<IssueLockRecord>;
}

export const FIND_ALBUM_OWNERS_QUERY = `
  MATCH (album:Album)
  WHERE album.id IN $ids
  OPTIONAL MATCH (owner:User)-[:HAS_ALBUM]->(album)
  RETURN album.id AS id, head(collect(owner.username)) AS username
`;

export const FIND_COLLECTION_OWNERS_QUERY = `
  MATCH (collection:Collection)
  WHERE collection.id IN $ids
  OPTIONAL MATCH (collection)-[:CREATED_BY]->(owner:User)
  RETURN collection.id AS id, head(collect(owner.username)) AS username
`;

export const FIND_COMMENT_AUTHOR_QUERY = `
  MATCH (comment:Comment {id: $id})
  OPTIONAL MATCH (author)-[:AUTHORED_COMMENT]->(comment)
  RETURN author.username AS username, author.displayName AS displayName
  LIMIT 1
`;

export const FIND_DISCUSSION_AUTHOR_QUERY = `
  MATCH (discussion:Discussion {id: $id})
  OPTIONAL MATCH (author:User)-[:POSTED_DISCUSSION]->(discussion)
  RETURN author.username AS username
  LIMIT 1
`;

export const FIND_EVENT_POSTER_QUERY = `
  MATCH (event:Event {id: $id})
  OPTIONAL MATCH (poster:User)-[:POSTED_BY]->(event)
  RETURN poster.username AS username
  LIMIT 1
`;

export const FIND_IMAGE_UPLOADER_QUERY = `
  MATCH (image:Image {id: $id})
  OPTIONAL MATCH (uploader:User)-[:UPLOADED_IMAGE]->(image)
  RETURN uploader.username AS username
  LIMIT 1
`;

export const FIND_ISSUE_AUTHOR_QUERY = `
  MATCH (issue:Issue {id: $id})
  OPTIONAL MATCH (issue)-[:AUTHORED_ISSUE]->(author)
  RETURN author.username AS username, author.displayName AS displayName
  LIMIT 1
`;

export const FIND_ISSUE_LOCK_QUERY = `
  MATCH (issue:Issue {id: $id})
  RETURN issue.locked AS locked
  LIMIT 1
`;

export function createContentAuthorizationRepository(
  driver: Driver,
  database = resolveNeo4jDatabase()
): ContentAuthorizationRepository {
  const openAuthorizationSession = () =>
    driver.session({
      database,
      // Authorization reads stay on the leader so the request's bookmark
      // manager preserves read-your-own-writes behavior on causal clusters.
      defaultAccessMode: neo4j.session.WRITE,
    });

  const findOwners = async (
    query: string,
    ids: string[]
  ): Promise<UserOwnershipRecord[]> => {
    if (ids.length === 0) return [];

    const session = openAuthorizationSession();
    try {
      const result = await session.run(query, { ids });
      return result.records.map((record) => ({
        id: record.get("id"),
        username: record.get("username") ?? null,
      }));
    } finally {
      await session.close();
    }
  };

  const findUser = async (
    query: string,
    id: string
  ): Promise<UserAuthorizationRecord> => {
    const session = openAuthorizationSession();
    try {
      const result = await session.run(query, { id });
      const record = result.records[0];
      return {
        found: Boolean(record),
        username: record?.get("username") ?? null,
      };
    } finally {
      await session.close();
    }
  };

  const findActor = async (
    query: string,
    id: string
  ): Promise<ActorAuthorizationRecord> => {
    const session = openAuthorizationSession();
    try {
      const result = await session.run(query, { id });
      const record = result.records[0];
      if (!record) return { found: false, actor: null };

      const username = record.get("username") ?? null;
      const displayName = record.get("displayName") ?? null;
      return {
        found: true,
        actor:
          username || displayName ? { username, displayName } : null,
      };
    } finally {
      await session.close();
    }
  };

  return {
    findAlbumOwners(ids) {
      return findOwners(FIND_ALBUM_OWNERS_QUERY, ids);
    },

    findCollectionOwners(ids) {
      return findOwners(FIND_COLLECTION_OWNERS_QUERY, ids);
    },

    findCommentAuthor(id) {
      return findActor(FIND_COMMENT_AUTHOR_QUERY, id);
    },

    findDiscussionAuthor(id) {
      return findUser(FIND_DISCUSSION_AUTHOR_QUERY, id);
    },

    findEventPoster(id) {
      return findUser(FIND_EVENT_POSTER_QUERY, id);
    },

    findImageUploader(id) {
      return findUser(FIND_IMAGE_UPLOADER_QUERY, id);
    },

    findIssueAuthor(id) {
      return findActor(FIND_ISSUE_AUTHOR_QUERY, id);
    },

    async findIssueLock(id) {
      const session = openAuthorizationSession();
      try {
        const result = await session.run(FIND_ISSUE_LOCK_QUERY, { id });
        const record = result.records[0];
        return {
          found: Boolean(record),
          locked: record?.get("locked") ?? null,
        };
      } finally {
        await session.close();
      }
    },
  };
}
