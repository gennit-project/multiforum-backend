import { GraphQLError } from "graphql";
import type { Driver } from "neo4j-driver";
import type { DiscussionCreateInput } from "../../src/generated/graphql.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";
import { executeManagedWrite } from "../neo4jTransactions.js";
import { createDiscussionChannelQuery } from "../../customResolvers/cypher/cypherQueries.js";
import { stripDiscussionToOneConnects } from "./discussionAlbumWrite.js";
import { DISCUSSION_CREATE_SELECTION } from "./discussionCreationRepository.js";

export async function createExistingDiscussionCrosspost(driver:Driver, input:DiscussionCreateInput,
  targetId:string, username:string, channels:string[], flairs:Map<string,string[]>, sensitive:boolean) {
  if (input.CrosspostedDiscussion) throw new GraphQLError("Use crosspostedDiscussionId without nested crosspost creation.");
  return executeManagedWrite(driver, async tx => {
    const target = await tx.run(`MATCH (d:Discussion {id:$id})
      WHERE coalesce(d.deleted,false) = false AND ($sensitive OR coalesce(d.hasSensitiveContent,false) = false)
      RETURN d.id`,{id:targetId,sensitive});
    if (target.records.length !== 1) throw new GraphQLError("Crossposted discussion is unavailable.");
    const reused = input.Album?.create?.node?.Images?.connect?.flatMap(c=>c.where?.node?.id?.eq ? [c.where.node.id.eq] : []) ?? [];
    for (const imageId of reused) {
      const image = await tx.run(`MATCH (i:Image {id:$id}) WHERE coalesce(i.archived,false) = false
        AND coalesce(i.permanentlyRemoved,false) = false AND ($sensitive OR coalesce(i.hasSensitiveContent,false) = false)
        RETURN i.id`,{id:imageId,sensitive});
      if (image.records.length !== 1) throw new GraphQLError("An album image is unavailable.");
    }
    const result = await executeGeneratedOperation<{createDiscussions:{discussions:Array<{id:string}>}}>(driver,
      `mutation CreateCrosspost($input:[DiscussionCreateInput!]!){createDiscussions(input:$input){discussions{id}}}`,{input:[stripDiscussionToOneConnects(input).cleaned]},tx);
    const id = result.createDiscussions.discussions[0].id;
    await tx.run(`MATCH (d:Discussion {id:$id}),(target:Discussion {id:$target}),(u:User {username:$username})
      MERGE (u)-[:POSTED_DISCUSSION]->(d) MERGE (d)-[:CROSSPOSTED_DISCUSSION]->(target)`,{id,target:targetId,username});
    // Only newly created images are attributed. Connected images retain their uploader.
    await tx.run(`MATCH (:Discussion {id:$id})-[:HAS_ALBUM]->(a:Album),(u:User {username:$username})
      MERGE (u)-[:HAS_ALBUM]->(a)
      WITH a,u MATCH (a)-[:HAS_IMAGE]->(i:Image)
      WHERE NOT i.id IN $reused AND NOT EXISTS { MATCH (:User)-[:UPLOADED_IMAGE]->(i) }
      MERGE (u)-[:UPLOADED_IMAGE]->(i)`,{id,username,reused});
    for (const channel of channels) {
      const exists = await tx.run(`MATCH (:Channel {uniqueName:$channel}) RETURN count(*) AS count`,{channel});
      if (Number(exists.records[0].get("count")) !== 1) throw new GraphQLError("Channel not found.");
      await tx.run(createDiscussionChannelQuery,{discussionId:id,channelUniqueName:channel,upvotedBy:username,flairIds:flairs.get(channel) ?? []});
    }
    const read = await executeGeneratedOperation<{discussions:unknown[]}>(driver,
      `query CrosspostResult($id:ID!){discussions(where:{id:{eq:$id}})${DISCUSSION_CREATE_SELECTION}}`,{id},tx,{mayAccessSensitiveContent:sensitive});
    return read.discussions[0];
  });
}
