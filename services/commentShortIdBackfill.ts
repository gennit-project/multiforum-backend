import type { Driver } from "neo4j-driver";
import { COMMENT_SHORT_ID_CYPHER } from "./commentShortId.js";

/**
 * Backfills the `shortId` URL handle for comments that lack one — legacy
 * comments and any created before this field existed. Idempotent: only touches
 * comments where shortId IS NULL, so it is safe to run on every startup. Must
 * run BEFORE ensureCoreSchemaConstraints creates the Comment.shortId uniqueness
 * constraint, otherwise the not-yet-assigned comments would be scanned by a
 * constraint that assumes uniqueness (and on a dev DB the field would stay
 * null). Mirrors discussionNumberBackfill / eventNumberBackfill.
 */
const numberValue = (value: unknown): number =>
  typeof (value as { toNumber?: () => number })?.toNumber === "function"
    ? (value as { toNumber: () => number }).toNumber()
    : Number(value ?? 0);

const BACKFILL_QUERY = `
  MATCH (c:Comment)
  WHERE c.shortId IS NULL
  SET c.shortId = ${COMMENT_SHORT_ID_CYPHER}
  RETURN count(c) AS commentsAssigned
`;

export type CommentShortIdBackfillResult = {
  commentsAssigned: number;
};

export const backfillCommentShortIds = async (
  driver: Driver
): Promise<CommentShortIdBackfillResult> => {
  const session = driver.session({ defaultAccessMode: "WRITE" });
  try {
    const result = await session.executeWrite((tx) => tx.run(BACKFILL_QUERY));
    return {
      commentsAssigned: numberValue(result.records[0]?.get("commentsAssigned")),
    };
  } finally {
    await session.close();
  }
};
