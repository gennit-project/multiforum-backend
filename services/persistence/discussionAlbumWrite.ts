import type { ManagedTransaction } from "neo4j-driver";

/**
 * FAMILY-3 / v7 (campaign #284). Album ownership for discussions.
 *
 * On CREATE, the generated createDiscussions still nests the Album (to-one
 * create) and its Images (to-many create); only the to-one Owner / per-image
 * Uploader connects were removed, so the resolver strips those and this module
 * wires the ownership edges afterwards, keyed on the discussion's album.
 *
 * On UPDATE, v7's DiscussionUpdateInput no longer carries the Album relationship
 * at all, so the album (and any newly nested images) is created/updated entirely
 * here as owned Cypher: (Discussion)-[:HAS_ALBUM]->(Album)-[:HAS_IMAGE]->(Image),
 * with (User)-[:HAS_ALBUM]->(Album) and (User)-[:UPLOADED_IMAGE]->(Image).
 */

// Image scalar map with any to-one Uploader connect removed (the owner is wired
// by edge here instead).
export type AlbumImageScalars = Record<string, unknown>;

export type DiscussionAlbumWrite = {
  discussionId: string;
  username?: string | null;
  // "create": the discussion had no album and one is being added.
  // "update": the discussion's existing album is being changed.
  mode: "create" | "update";
  imageOrder?: unknown;
  images: AlbumImageScalars[];
};

// Shared image-create tail: create each nested image with the generated defaults
// and wire HAS_IMAGE + UPLOADED_IMAGE. `a` (Album) and $username must be in scope.
const CREATE_IMAGES_TAIL = `
 WITH a
 UNWIND (CASE WHEN size($images) = 0 THEN [] ELSE $images END) AS imgScalars
 CREATE (image:Image)
 SET image += imgScalars
 SET image.id = randomUUID(),
     image.createdAt = datetime(),
     image.ageGateTouchedAt = datetime(),
     image.scanStatus = coalesce(image.scanStatus, 'PENDING'),
     image.archived = coalesce(image.archived, false),
     image.permanentlyRemoved = coalesce(image.permanentlyRemoved, false)
 CREATE (a)-[:HAS_IMAGE]->(image)
 WITH a, image
 OPTIONAL MATCH (owner:User {username: $username})
 FOREACH (_ IN CASE WHEN owner IS NULL THEN [] ELSE [1] END |
  MERGE (owner)-[:UPLOADED_IMAGE]->(image)
 )
`;

const CREATE_ALBUM = `
 MATCH (d:Discussion {id: $discussionId})
 CREATE (a:Album {id: randomUUID()})
 SET a.imageOrder = $imageOrder
 CREATE (d)-[:HAS_ALBUM]->(a)
 WITH a
 OPTIONAL MATCH (owner:User {username: $username})
 FOREACH (_ IN CASE WHEN owner IS NULL THEN [] ELSE [1] END |
  MERGE (owner)-[:HAS_ALBUM]->(a)
 )
${CREATE_IMAGES_TAIL}
`;

const UPDATE_ALBUM = `
 MATCH (d:Discussion {id: $discussionId})-[:HAS_ALBUM]->(a:Album)
 SET a.imageOrder = CASE WHEN $imageOrder IS NULL THEN a.imageOrder ELSE $imageOrder END
${CREATE_IMAGES_TAIL}
`;

// Post-create ownership for the create resolver: the generated mutation already
// created the album and its images, so just wire the owner edges.
const CONNECT_CREATED_ALBUM_OWNERSHIP = `
 MATCH (d:Discussion {id: $discussionId})-[:HAS_ALBUM]->(a:Album)
 OPTIONAL MATCH (owner:User {username: $username})
 FOREACH (_ IN CASE WHEN owner IS NULL THEN [] ELSE [1] END |
  MERGE (owner)-[:HAS_ALBUM]->(a)
 )
 WITH a, owner
 OPTIONAL MATCH (a)-[:HAS_IMAGE]->(img:Image)
 FOREACH (_ IN CASE WHEN (owner IS NULL OR img IS NULL) THEN [] ELSE [1] END |
  MERGE (owner)-[:UPLOADED_IMAGE]->(img)
 )
`;

export async function connectCreatedDiscussionAlbumOwnership(
  tx: ManagedTransaction,
  params: { discussionId: string; username?: string | null }
): Promise<void> {
  await tx.run(CONNECT_CREATED_ALBUM_OWNERSHIP, {
    discussionId: params.discussionId,
    username: params.username ?? null,
  });
}

export async function writeDiscussionAlbum(
  tx: ManagedTransaction,
  params: DiscussionAlbumWrite
): Promise<void> {
  await tx.run(params.mode === "create" ? CREATE_ALBUM : UPDATE_ALBUM, {
    discussionId: params.discussionId,
    username: params.username ?? null,
    imageOrder: params.imageOrder ?? null,
    images: params.images,
  });
}

// Pull the image scalar maps out of an Album field input's Images.create,
// dropping the to-one Uploader connect (wired by edge) and the GraphQL node
// wrapper. Accepts both the array and single-object create shapes.
export function albumImageScalars(imagesField: unknown): AlbumImageScalars[] {
  const create = (imagesField as { create?: unknown } | null | undefined)?.create;
  if (!create) return [];
  const entries = Array.isArray(create) ? create : [create];
  return entries
    .map((entry) => (entry as { node?: Record<string, unknown> } | null)?.node)
    .filter((node): node is Record<string, unknown> => !!node)
    .map(({ Uploader, ...scalars }) => {
      void Uploader;
      return scalars;
    });
}
