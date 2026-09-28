import { GraphQLError } from "graphql";

export type DiscussionListCursorSort = "hot" | "new" | "top";

export type DiscussionListCursor = {
  sort: DiscussionListCursorSort;
  sortValue: number | null;
  createdAt: string;
  discussionId: string;
  rankingAnchor: string | null;
};

type EncodedDiscussionListCursor = {
  v: 1;
  s: DiscussionListCursorSort;
  r: number | null;
  c: string;
  i: string;
  a: string | null;
};

const invalidCursor = () =>
  new GraphQLError("after must be a valid cursor for the selected sort.", {
    extensions: { code: "BAD_USER_INPUT" },
  });

export const encodeDiscussionListCursor = (
  cursor: DiscussionListCursor
): string => {
  const encoded: EncodedDiscussionListCursor = {
    v: 1,
    s: cursor.sort,
    r: cursor.sortValue,
    c: cursor.createdAt,
    i: cursor.discussionId,
    a: cursor.rankingAnchor,
  };

  return Buffer.from(JSON.stringify(encoded), "utf8").toString("base64url");
};

export const decodeDiscussionListCursor = ({
  after,
  expectedSort,
}: {
  after?: string | null;
  expectedSort: DiscussionListCursorSort;
}): DiscussionListCursor | null => {
  if (!after) return null;

  try {
    const decoded = JSON.parse(
      Buffer.from(after, "base64url").toString("utf8")
    ) as Partial<EncodedDiscussionListCursor>;
    const needsRankValue = expectedSort === "hot" || expectedSort === "top";
    const hasValidRankValue =
      !needsRankValue ||
      (typeof decoded.r === "number" && Number.isFinite(decoded.r));
    const needsRankingAnchor = expectedSort === "hot" || expectedSort === "top";
    const hasValidRankingAnchor =
      !needsRankingAnchor ||
      (typeof decoded.a === "string" && decoded.a.length > 0);

    if (
      decoded.v !== 1 ||
      decoded.s !== expectedSort ||
      typeof decoded.c !== "string" ||
      decoded.c.length === 0 ||
      typeof decoded.i !== "string" ||
      decoded.i.length === 0 ||
      !hasValidRankValue ||
      !hasValidRankingAnchor
    ) {
      throw invalidCursor();
    }

    return {
      sort: decoded.s,
      sortValue: typeof decoded.r === "number" ? decoded.r : null,
      createdAt: decoded.c,
      discussionId: decoded.i,
      rankingAnchor: typeof decoded.a === "string" ? decoded.a : null,
    };
  } catch (error: unknown) {
    if (error instanceof GraphQLError) throw error;
    throw invalidCursor();
  }
};

