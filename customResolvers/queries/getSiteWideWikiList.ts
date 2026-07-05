import type { Driver, Record as Neo4jRecord } from "neo4j-driver";
import { getSiteWideWikiPagesQuery } from "../cypher/cypherQueries.js";
import { logger } from "../../logger.js";

type WikiPageListItem = {
  id?: string | null;
  title?: string | null;
  body?: string | null;
  slug?: string | null;
  channelUniqueName?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
  VersionAuthor?: {
    username?: string | null;
    displayName?: string | null;
    profilePicURL?: string | null;
  } | null;
};

type Input = {
  driver: Driver;
};

type Args = {
  searchInput?: string;
  selectedChannels?: string[];
  options?: {
    offset?: number;
    limit?: number;
  };
};

const getResolver = (input: Input) => {
  const { driver } = input;

  return async (_parent: unknown, args: Args) => {
    const {
      searchInput = "",
      selectedChannels = [],
      options,
    } = args;
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 25;
    const titleRegex = `(?i).*${searchInput}.*`;
    const bodyRegex = `(?i).*${searchInput}.*`;

    const session = driver.session();
    let totalCount = 0;

    try {
      const result = await session.run(getSiteWideWikiPagesQuery, {
        searchInput,
        titleRegex,
        bodyRegex,
        selectedChannels,
        offset,
        limit,
      });

      const record = result.records[0];
      if (record) {
        totalCount = record.get("totalCount");
      }

      const wikiPages = result.records.map((record: Neo4jRecord) =>
        record.get("wikiPage")
      );
      const featuredWikiPages = await getFeaturedWikiPages(driver);

      return {
        wikiPages,
        featuredWikiPages,
        aggregateWikiPageCount: totalCount,
      };
    } catch (error: unknown) {
      logger.error("Error getting wiki pages:", error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to fetch wiki pages. ${message}`);
    } finally {
      session.close();
    }
  };
};

const getFeaturedWikiPages = async (driver: Driver) => {
  const session = driver.session();

  try {
    const result = await session.run(`
      MATCH (serverConfig:ServerConfig)
      WITH coalesce(serverConfig.featuredWikiPageIds, []) AS featuredIds
      UNWIND range(0, size(featuredIds) - 1) AS index
      WITH featuredIds, index
      WHERE index >= 0
      MATCH (w:WikiPage { id: featuredIds[index] })
      OPTIONAL MATCH (w)<-[:AUTHORED_VERSION]-(author:User)
      WITH index, w, author
      ORDER BY index ASC
      RETURN {
        id: w.id,
        title: w.title,
        body: w.body,
        slug: w.slug,
        channelUniqueName: w.channelUniqueName,
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
        VersionAuthor: CASE
          WHEN author IS NULL THEN null
          ELSE {
            username: author.username,
            displayName: author.displayName,
            profilePicURL: author.profilePicURL
          }
        END
      } AS wikiPage
    `);

    return result.records.map((record: Neo4jRecord) =>
      record.get("wikiPage")
    ) as WikiPageListItem[];
  } finally {
    await session.close();
  }
};

export default getResolver;
