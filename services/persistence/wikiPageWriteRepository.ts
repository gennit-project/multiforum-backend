import { GraphQLError } from "graphql";
import type { Driver } from "neo4j-driver";
import type { WriteWikiPageInput } from "../../src/generated/graphql.js";
import { executeManagedWrite } from "../neo4jTransactions.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";

export async function writeWikiPageRecord(driver:Driver,input:WriteWikiPageInput,username:string) {
  return executeManagedWrite(driver, async tx => {
    const channel = await tx.run(`MATCH (c:Channel {uniqueName:$channel}) RETURN c.uniqueName`,{channel:input.channelUniqueName});
    if (channel.records.length !== 1) throw new GraphQLError("Channel not found.");
    if (input.parentId) {
      const parent = await tx.run(`MATCH (:Channel {uniqueName:$channel})-[:OWNS_WIKI_PAGE]->(p:WikiPage {id:$parent}) RETURN p.id`,{channel:input.channelUniqueName,parent:input.parentId});
      if (parent.records.length !== 1) throw new GraphQLError("Parent page must belong to the channel.");
    }
    let id = input.id;
    if (id) {
      // Lock the page before reading its previous content and author. Revisions,
      // attribution and text then commit or roll back together.
      const snapshot = await tx.run(`MATCH (:Channel {uniqueName:$channel})-[:OWNS_WIKI_PAGE]->(p:WikiPage {id:$id})
        SET p.updatedAt = datetime()
        WITH p
        OPTIONAL MATCH (author:User)-[:AUTHORED_VERSION]->(p)
        RETURN p.title AS title,p.body AS body,p.editReason AS reason,author.username AS author`, {channel:input.channelUniqueName,id});
      if (snapshot.records.length !== 1) throw new GraphQLError("Wiki page not found in this channel.");
      const old = snapshot.records[0];
      const changed = old.get("title") !== input.title || old.get("body") !== (input.body ?? null);
      if (changed && !old.get("author")) throw new GraphQLError("Existing page is missing its revision author.");
      if (changed) {
        for (const field of ["title","body"] as const) {
          if (old.get(field) === (input[field] ?? null)) continue;
          // Existing migrated pages may not have a snapshot of their current
          // text. Preserve it once; new writes already recorded it on arrival.
          if (old.get(field) != null) {
            await recordWikiRevision(tx, id, old.get(field), old.get("reason"), old.get("author"), true);
          }
          // Contributions and revision reports need the current edit immediately,
          // not only after a later edit moves it into history.
          await recordWikiRevision(tx, id, input[field] ?? null, input.editReason ?? null, username);
        }
      }
      if (changed) {
      await tx.run(`MATCH (p:WikiPage {id:$id}) OPTIONAL MATCH (:User)-[r:AUTHORED_VERSION]->(p) DELETE r`,{id});
      await tx.run(`MATCH (p:WikiPage {id:$id}), (u:User {username:$username})
        SET p.title=$title,p.body=$body,p.editReason=$reason,p.updatedAt=datetime()
        MERGE (u)-[:AUTHORED_VERSION]->(p)`,{id,username,title:input.title,body:input.body ?? null,reason:input.editReason ?? null});
      }
    } else {
      const created = await tx.run(`MATCH (c:Channel {uniqueName:$channel}),(u:User {username:$username})
        CREATE (c)-[:OWNS_WIKI_PAGE]->(p:WikiPage {id:randomUUID(),channelUniqueName:$channel,slug:$slug,title:$title,body:$body,editReason:$reason,locked:false,createdAt:datetime()})
        CREATE (u)-[:AUTHORED_WIKI_PAGE]->(p) CREATE (u)-[:AUTHORED_VERSION]->(p)
        RETURN p.id AS id`,{channel:input.channelUniqueName,username,slug:input.slug,title:input.title,body:input.body ?? null,reason:input.editReason ?? null});
      id = created.records[0]?.get("id");
      if (!id) throw new GraphQLError("Wiki author not found.");
      await recordWikiRevision(tx, id, input.title, input.editReason ?? null, username);
      if (input.body != null) await recordWikiRevision(tx, id, input.body, input.editReason ?? null, username);
      if (input.parentId) await tx.run(`MATCH (parent:WikiPage {id:$parent}), (p:WikiPage {id:$id}) CREATE (parent)-[:HAS_CHILD_PAGE]->(p)`,{parent:input.parentId,id});
    }
    if (input.setAsHome) await linkWikiHome(tx,input.channelUniqueName,id!);
    const result = await executeGeneratedOperation<{wikiPages:unknown[]}>(driver,`query WrittenWikiPage($id:ID!){wikiPages(where:{id:{eq:$id}}){id title body slug channelUniqueName editReason createdAt updatedAt locked OriginalAuthor{username} VersionAuthor{username} Channel{uniqueName} ChildPages{id title slug} PastVersions{id body editReason createdAt Author{username}}}}`,{id},tx);
    return result.wikiPages[0];
  });
}
export async function linkWikiHome(tx: import("neo4j-driver").ManagedTransaction, channel:string, id:string) {
  const found = await tx.run(`MATCH (c:Channel {uniqueName:$channel})-[:OWNS_WIKI_PAGE]->(p:WikiPage {id:$id})
    OPTIONAL MATCH (c)-[old:HAS_WIKI_HOME_PAGE]->() DELETE old
    MERGE (c)-[:HAS_WIKI_HOME_PAGE]->(p) RETURN p.id`,{channel,id});
  if (found.records.length !== 1) throw new GraphQLError("Home page must belong to the channel.");
}

async function recordWikiRevision(
  tx: import("neo4j-driver").ManagedTransaction,
  id: string,
  body: string | null,
  reason: string | null,
  author: string,
  onlyIfMissing = false
) {
  await tx.run(`MATCH (p:WikiPage {id:$id}), (u:User {username:$author})
    WHERE NOT $onlyIfMissing OR NOT EXISTS {
      MATCH (p)-[:HAS_VERSION]->(previous:TextVersion)<-[:AUTHORED_VERSION]-(u)
      WHERE previous.body = $body AND coalesce(previous.editReason,'') = coalesce($reason,'')
    }
    CREATE (p)-[:HAS_VERSION]->(v:TextVersion {id:randomUUID(),body:$body,editReason:$reason,createdAt:datetime(),ageGateTouchedAt:datetime()})
    CREATE (u)-[:AUTHORED_VERSION]->(v)`, {id,author,body,reason,onlyIfMissing});
}
