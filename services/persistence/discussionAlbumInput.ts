import { GraphQLError } from "graphql";
import type { ManagedTransaction } from "neo4j-driver";
import type { DiscussionAlbumInput } from "../../src/generated/graphql.js";

/** Replace album membership/order; uploaded images keep their existing uploader. */
export async function writeDiscussionAlbumInput(tx: ManagedTransaction, discussionId: string,
  username: string, input: DiscussionAlbumInput, mayAccessSensitiveContent: boolean) {
  const ids = input.imageIds;
  if (new Set(ids).size !== ids.length || ids.some(id => !id)) throw new GraphQLError("Image IDs must be unique and non-empty.");
  for (const edit of input.imageUpdates ?? []) {
    if (!ids.includes(edit.id)) throw new GraphQLError("Updated images must belong to this album.");
  }
  const discussion = await tx.run(`MATCH (d:Discussion {id:$id})
    SET d.ageGateTouchedAt = datetime()
    WITH d
    OPTIONAL MATCH (d)-[:HAS_ALBUM]->(a:Album)
    RETURN a.id AS albumId, EXISTS { MATCH (other:Discussion)-[:HAS_ALBUM]->(a) WHERE other <> d } AS shared`, {id:discussionId});
  if (discussion.records.length !== 1 || discussion.records[0].get("shared")) throw new GraphQLError("Discussion album cannot be updated.");
  const images = await tx.run(`MATCH (i:Image) WHERE i.id IN $ids
    AND coalesce(i.archived,false) = false AND coalesce(i.permanentlyRemoved,false) = false
    AND ($sensitive OR coalesce(i.hasSensitiveContent,false) = false)
    RETURN i.id AS id`, {ids,sensitive:mayAccessSensitiveContent});
  if (images.records.length !== ids.length) throw new GraphQLError("An image is unavailable.");
  for (const {id, ...changes} of input.imageUpdates ?? []) {
    const result = await tx.run(`MATCH (u:User {username:$username})-[:UPLOADED_IMAGE]->(i:Image {id:$id})
      SET i += $changes, i.ageGateTouchedAt = datetime() RETURN i.id AS id`, {username,id,changes});
    if (result.records.length !== 1) throw new GraphQLError("Only the uploader may edit image metadata.");
  }
  await tx.run(`MATCH (d:Discussion {id:$id}), (u:User {username:$username})
    MERGE (d)-[:HAS_ALBUM]->(a:Album)
    ON CREATE SET a.id = randomUUID()
    WITH a, u
    OPTIONAL MATCH (:User)-[ownership:HAS_ALBUM]->(a)
    FOREACH (_ IN CASE WHEN ownership IS NULL THEN [1] ELSE [] END | MERGE (u)-[:HAS_ALBUM]->(a))
    SET a.imageOrder = $ids
    WITH DISTINCT a
    OPTIONAL MATCH (a)-[r:HAS_IMAGE]->(i:Image) WHERE NOT i.id IN $ids
    DELETE r`, {id:discussionId,username,ids});
  await tx.run(`MATCH (:Discussion {id:$id})-[:HAS_ALBUM]->(a:Album)
    UNWIND $ids AS imageId MATCH (i:Image {id:imageId}) MERGE (a)-[:HAS_IMAGE]->(i)`, {id:discussionId,ids});
}
