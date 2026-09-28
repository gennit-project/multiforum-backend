import type { Driver, Record as Neo4jRecord } from "neo4j-driver";
import type { ServerConfigModel } from "../../ogm_types.js";
import { mayAccessSensitiveContent } from "../../services/sensitiveContentAccess.js";
import type { GraphQLContext } from "../../types/context.js";
import {
  decodeDetailCollectionCursor,
  encodeDetailCollectionCursor,
  type DetailCollectionKind,
} from "../../services/detailCollectionCursor.js";
import { normalizePagination } from "../../services/pagination.js";
import {
  getDiscussionDetailAnswersPageQuery,
  getDiscussionDetailFilesPageQuery,
  getDiscussionDetailImagesPageQuery,
} from "../cypher/cypherQueries.js";

type Input = {
  driver: Driver;
  ServerConfig?: ServerConfigModel;
};

type Args = {
  discussionId: string;
  channelUniqueName: string;
  after?: string | null;
  limit?: number | null;
};

type PageConfig = {
  kind: DetailCollectionKind;
  outputKey: "answers" | "files" | "images";
  query: string;
  defaultLimit: number;
};

const PAGE_LIMIT_MAX = 50;

const configs: Record<DetailCollectionKind, PageConfig> = {
  answer: {
    kind: "answer",
    outputKey: "answers",
    query: getDiscussionDetailAnswersPageQuery,
    defaultLimit: 5,
  },
  file: {
    kind: "file",
    outputKey: "files",
    query: getDiscussionDetailFilesPageQuery,
    defaultLimit: 12,
  },
  image: {
    kind: "image",
    outputKey: "images",
    query: getDiscussionDetailImagesPageQuery,
    defaultLimit: 12,
  },
};

const normalizeCursorDate = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "toString" in value) {
    return String(value);
  }
  return "";
};

export const createDiscussionDetailCollectionPageResolver = ({
  driver,
  ServerConfig,
  kind,
}: Input & { kind: DetailCollectionKind }) => {
  const config = configs[kind];

  return async (_parent: unknown, args: Args, context: GraphQLContext) => {
    const { limit } = normalizePagination({
      limit: args.limit,
      defaultLimit: config.defaultLimit,
      maxLimit: PAGE_LIMIT_MAX,
    });
    const cursor = decodeDetailCollectionCursor({
      after: args.after,
      expectedKind: kind,
    });
    const canViewSensitiveContent = await mayAccessSensitiveContent({
      context,
      driver,
      ServerConfig,
    });
    const session = driver.session();

    try {
      return await session.executeWrite(async (transaction) => {
        const result = await transaction.run(config.query, {
          discussionId: args.discussionId,
          channelUniqueName: args.channelUniqueName,
          mayAccessSensitiveContent: canViewSensitiveContent,
          cursorCreatedAt: cursor?.createdAt ?? null,
          cursorId: cursor?.id ?? null,
          pageLimit: limit + 1,
        });
        const hasNextPage = result.records.length > limit;
        const selectedRecords = result.records.slice(0, limit);
        const lastRecord = selectedRecords[selectedRecords.length - 1] as
          | Neo4jRecord
          | undefined;
        const cursorCreatedAt = lastRecord
          ? normalizeCursorDate(lastRecord.get("cursorCreatedAt"))
          : "";
        const cursorId = lastRecord?.get("cursorId") as string | undefined;
        const endCursor =
          cursorCreatedAt && cursorId
            ? encodeDetailCollectionCursor({
                kind,
                createdAt: cursorCreatedAt,
                id: cursorId,
              })
            : null;

        return {
          [config.outputKey]: selectedRecords.map((record) => record.get("item")),
          pageInfo: { endCursor, hasNextPage },
        };
      });
    } finally {
      await session.close();
    }
  };
};

