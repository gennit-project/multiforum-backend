import { GraphQLError } from "graphql";

export type DetailCollectionKind = "answer" | "file" | "image";

export type DetailCollectionCursor = {
  kind: DetailCollectionKind;
  createdAt: string;
  id: string;
};

type EncodedDetailCollectionCursor = {
  v: 1;
  k: DetailCollectionKind;
  c: string;
  i: string;
};

const invalidCursor = () =>
  new GraphQLError("after must be a valid cursor for this detail collection.", {
    extensions: { code: "BAD_USER_INPUT" },
  });

export const encodeDetailCollectionCursor = (
  cursor: DetailCollectionCursor
): string => {
  const encoded: EncodedDetailCollectionCursor = {
    v: 1,
    k: cursor.kind,
    c: cursor.createdAt,
    i: cursor.id,
  };

  return Buffer.from(JSON.stringify(encoded), "utf8").toString("base64url");
};

export const decodeDetailCollectionCursor = ({
  after,
  expectedKind,
}: {
  after?: string | null;
  expectedKind: DetailCollectionKind;
}): DetailCollectionCursor | null => {
  if (!after) return null;

  try {
    const decoded = JSON.parse(
      Buffer.from(after, "base64url").toString("utf8")
    ) as Partial<EncodedDetailCollectionCursor>;

    if (
      decoded.v !== 1 ||
      decoded.k !== expectedKind ||
      typeof decoded.c !== "string" ||
      decoded.c.length === 0 ||
      typeof decoded.i !== "string" ||
      decoded.i.length === 0
    ) {
      throw invalidCursor();
    }

    return {
      kind: decoded.k,
      createdAt: decoded.c,
      id: decoded.i,
    };
  } catch (error: unknown) {
    if (error instanceof GraphQLError) throw error;
    throw invalidCursor();
  }
};

