import { assertCommentEmojiEnabled } from "../../customResolvers/mutations/channelPreferenceGuards.js";
import assert from "node:assert/strict";
import { after, before, beforeEach, test, type TestContext } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import type { Driver } from "neo4j-driver";
import type { GraphQLResolveInfo } from "graphql";
import getCustomResolvers from "../helpers/getTestResolvers.js";
import typeDefs from "../../typeDefs.js";
import type { GraphQLContext } from "../../types/context.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { createContentValidationRepository } from "../../services/persistence/contentValidationRepository.js";
import { resetDatabase, startNeo4j, stopNeo4j } from "./neo4jHarness.js";

let driver: Driver;
before(async () => {
  driver = await startNeo4j();
  const app = getCustomResolvers(driver);
  const neoSchema = new Neo4jGraphQL({
    typeDefs, driver, resolvers: app.resolvers,
    features: { filters: { String: { MATCHES: true } }, subscriptions: true },
  });
  const schema = await neoSchema.getSchema();
  registerGeneratedSchema(driver, schema);
}, { timeout: 240_000 });
beforeEach(async () => resetDatabase(driver));
after(async () => stopNeo4j());
const plain=(value:unknown)=>JSON.parse(JSON.stringify(value));
const discussionEmojiSelection=`{
      id
      emoji
      locked
      archived
      channelUniqueName
      Channel {
        uniqueName
        emojiEnabled
      }
    }`;
const commentEmojiSelection=`{
      id
      emoji
      archived
      Channel {
        uniqueName
        emojiEnabled
      }
      DiscussionChannel {
        channelUniqueName
        locked
        archived
        Channel {
          uniqueName
          emojiEnabled
        }
      }
    }`;
const reads = (where: any = {}) => {
 const repo=createContentValidationRepository(driver);
 return [
  ()=>repo.findDiscussionChannels(where),
  ()=>repo.findExistingDownloadableFiles(where),
 ] as const;
};
const compare=async(t:TestContext,current:()=>Promise<unknown>)=>t.assert.snapshot(plain(await current()));
const seed=async()=>driver.executeQuery(`
 CREATE (channel:Channel {uniqueName:'cats',emojiEnabled:false})
 CREATE (discussion:Discussion {id:'d',title:'topic'})
 CREATE (dc:DiscussionChannel {id:'dc',channelUniqueName:'cats',emoji:'{}',locked:false,archived:false})
 CREATE (dc)-[:POSTED_IN_CHANNEL]->(channel)
 CREATE (dc)-[:POSTED_IN_CHANNEL]->(discussion)
 CREATE (comment:Comment {id:'c',emoji:'{}',archived:false})
 CREATE (dc)-[:CONTAINS_COMMENT]->(comment)
 CREATE (channel)-[:HAS_COMMENT]->(comment)
 CREATE (:DownloadableFile {id:'f',fileName:'old.zip'})
`);
const compareEmoji=async(t:TestContext)=>{
 const repo=createContentValidationRepository(driver);
 await compare(t,()=>repo.findDiscussionChannelEmojiState("dc"));
 await compare(t,()=>repo.findCommentEmojiState("c"));
};
test("all four validation snapshots preserve missing and populated results",async(t)=>{
 for (const read of reads()) await compare(t,read); await compareEmoji(t);
 await seed(); for(const read of reads()) await compare(t,read); await compareEmoji(t);
 const rows=await createContentValidationRepository(driver).findCommentEmojiState("c"); assert.equal(rows[0].Channel?.emojiEnabled,false);
});
test("arbitrary compound filters and default25 limits match generated operations",async(t)=>{
 await driver.executeQuery("UNWIND range(0,29) AS i CREATE (:Discussion {id:toString(i),title:'topic'}) CREATE (:DownloadableFile {id:toString(i),fileName:'old.zip'})");
 for(const read of reads({OR:[{id:{startsWith:"1"}},{id:{startsWith:"2"}}]})) await compare(t,read);
 // Unfiltered reads hit the generated default limit of 25 over 30 rows; which 25
 // is only stable within a run (no ORDER BY), so assert the cap rather than
 // snapshotting a non-reproducible subset.
 for(const read of reads()) {assert.equal((await read()).length,25);}
});
test("sensitive roots and nested channels retain anonymous internal filtering",async(t)=>{
 await seed(); await driver.executeQuery("MATCH (n) WHERE n:Discussion OR n:Comment OR n:DiscussionChannel OR n:DownloadableFile SET n.ageGateRestricted=true SET n.hasSensitiveContent=true");
 for(const read of reads()) await compare(t,read); await compareEmoji(t);
 assert.deepEqual(await createContentValidationRepository(driver).findExistingDownloadableFiles({}),[]);
 assert.deepEqual(await createContentValidationRepository(driver).findCommentEmojiState("c"),[]);
});
const message=async(fn:()=>Promise<unknown>)=>{try{await fn();}catch(error){return (error as Error).message;}assert.fail("Expected error");};
test("malformed filters preserve first coercion error",async()=>{
 for(const read of reads({id:{eq:true}})) await assert.rejects(read(),/ID cannot represent/);
 for(const read of reads({unknownField:true})) await assert.rejects(read(),/Field "unknownField" is not defined by type/);
});
test("malformed selected values preserve first serialization error",async()=>{
 await seed(); await driver.executeQuery("MATCH (c:Comment) SET c.archived='invalid'");
 const repo=createContentValidationRepository(driver);
 await assert.rejects(repo.findCommentEmojiState("c"),/Boolean cannot represent a non boolean value/);
 await driver.executeQuery("MATCH (f:DownloadableFile) REMOVE f.fileName");
 await assert.rejects(repo.findExistingDownloadableFiles({}),/Cannot return null for non-nullable field DownloadableFile\.fileName/);
});

test("outer privileged auth is not inherited by validation snapshots",async()=>{
 await seed(); await driver.executeQuery("MATCH (c:Comment) SET c.ageGateRestricted=true");
 await assert.rejects(assertCommentEmojiEnabled({driver,jwt:{mayAccessSensitiveContent:true}} as unknown as GraphQLContext,"c"),{message:"Comment not found"});
});
test("nested discussion channels preserve filtering when the root remains visible",async(t)=>{
 await seed();await driver.executeQuery("MATCH (dc:DiscussionChannel) SET dc.ageGateRestricted=true");
 await compare(t,reads()[0]);await compareEmoji(t);
 const [discussion]=await createContentValidationRepository(driver).findDiscussionChannels({id:{eq:"d"}});
 assert.deepEqual(discussion.DiscussionChannels,[]);
 const [comment]=await createContentValidationRepository(driver).findCommentEmojiState("c");
 assert.equal(comment.DiscussionChannel,null);
});
