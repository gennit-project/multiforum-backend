import { assertCommentEmojiEnabled } from "../../customResolvers/mutations/channelPreferenceGuards.js";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import type { Driver } from "neo4j-driver";
import type { GraphQLResolveInfo } from "graphql";
import getCustomResolvers from "../../customResolvers.js";
import typeDefs from "../../typeDefs.js";
import type { GraphQLContext } from "../../types/context.js";
import { initializeOgmFromExistingSchema } from "../../services/initializeOgmFromExistingSchema.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { createContentValidationRepository } from "../../services/persistence/contentValidationRepository.js";
import { resetDatabase, startNeo4j, stopNeo4j } from "./neo4jHarness.js";

let driver: Driver;
let ogm: ReturnType<typeof getCustomResolvers>["ogm"];
before(async () => {
  driver = await startNeo4j();
  const app = getCustomResolvers(driver);
  ogm = app.ogm;
  const neoSchema = new Neo4jGraphQL({
    typeDefs, driver, resolvers: app.resolvers,
    features: { filters: { String: { MATCHES: true } }, subscriptions: true },
  });
  const schema = await neoSchema.getSchema();
  registerGeneratedSchema(driver, schema);
  initializeOgmFromExistingSchema(ogm, neoSchema, schema);
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
const pairs = (where: any = {}) => {
 const repo=createContentValidationRepository(driver);
 return [
  [()=>ogm.model("Discussion").find({where,selectionSet:"{DiscussionChannels {channelUniqueName}}"}),()=>repo.findDiscussionChannels(where)],
  [()=>ogm.model("DownloadableFile").find({where,selectionSet:"{id fileName}"}),()=>repo.findExistingDownloadableFiles(where)],
 ] as const;
};
const compare=async(old:()=>Promise<unknown>,current:()=>Promise<unknown>)=>assert.deepEqual(plain(await current()),plain(await old()));
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
const compareEmoji=async()=>{
 const repo=createContentValidationRepository(driver);
 await compare(()=>ogm.model("DiscussionChannel").find({where:{id:"dc"},selectionSet:discussionEmojiSelection}),()=>repo.findDiscussionChannelEmojiState("dc"));
 await compare(()=>ogm.model("Comment").find({where:{id:"c"},selectionSet:commentEmojiSelection}),()=>repo.findCommentEmojiState("c"));
};
test("all four validation snapshots preserve missing and populated results",async()=>{
 for (const pair of pairs()) await compare(pair[0],pair[1]); await compareEmoji();
 await seed(); for(const pair of pairs()) await compare(pair[0],pair[1]); await compareEmoji();
 const rows=await createContentValidationRepository(driver).findCommentEmojiState("c"); assert.equal(rows[0].Channel?.emojiEnabled,false);
});
test("arbitrary compound filters and default25 limits match generated operations",async()=>{
 await driver.executeQuery("UNWIND range(0,29) AS i CREATE (:Discussion {id:toString(i),title:'topic'}) CREATE (:DownloadableFile {id:toString(i),fileName:'old.zip'})");
 for(const pair of pairs({OR:[{id_STARTS_WITH:"1"},{id_STARTS_WITH:"2"}]})) await compare(pair[0],pair[1]);
 for(const pair of pairs()) {await compare(pair[0],pair[1]);assert.equal((await pair[1]()).length,25);}
});
test("sensitive roots and nested channels retain anonymous internal filtering",async()=>{
 await seed(); await driver.executeQuery("MATCH (n) WHERE n:Discussion OR n:Comment OR n:DiscussionChannel OR n:DownloadableFile SET n.ageGateRestricted=true SET n.hasSensitiveContent=true");
 for(const pair of pairs()) await compare(pair[0],pair[1]); await compareEmoji();
 assert.deepEqual(await createContentValidationRepository(driver).findExistingDownloadableFiles({}),[]);
 assert.deepEqual(await createContentValidationRepository(driver).findCommentEmojiState("c"),[]);
});
const message=async(fn:()=>Promise<unknown>)=>{try{await fn();}catch(error){return (error as Error).message;}assert.fail("Expected error");};
test("malformed filters preserve first coercion error",async()=>{
 for(const pair of pairs({id:true})) assert.equal(await message(pair[1]),await message(pair[0]));
 for(const pair of pairs({unknownField:true})) assert.equal(await message(pair[1]),await message(pair[0]));
});
test("malformed selected values preserve first serialization error",async()=>{
 await seed(); await driver.executeQuery("MATCH (c:Comment) SET c.archived='invalid'");
 const repo=createContentValidationRepository(driver);
 assert.equal(await message(()=>repo.findCommentEmojiState("c")),await message(()=>ogm.model("Comment").find({where:{id:"c"},selectionSet:commentEmojiSelection})));
 await driver.executeQuery("MATCH (f:DownloadableFile) REMOVE f.fileName");
 const pair=pairs()[1];assert.equal(await message(pair[1]),await message(pair[0]));
});

test("outer privileged auth is not inherited by validation snapshots",async()=>{
 await seed(); await driver.executeQuery("MATCH (c:Comment) SET c.ageGateRestricted=true");
 await assert.rejects(assertCommentEmojiEnabled({driver,ogm,jwt:{mayAccessSensitiveContent:true}} as unknown as GraphQLContext,"c"),{message:"Comment not found"});
});
test("nested discussion channels preserve filtering when the root remains visible",async()=>{
 await seed();await driver.executeQuery("MATCH (dc:DiscussionChannel) SET dc.ageGateRestricted=true");
 await compare(pairs()[0][0],pairs()[0][1]);await compareEmoji();
 const [discussion]=await createContentValidationRepository(driver).findDiscussionChannels({id:"d"});
 assert.deepEqual(discussion.DiscussionChannels,[]);
 const [comment]=await createContentValidationRepository(driver).findCommentEmojiState("c");
 assert.equal(comment.DiscussionChannel,null);
});
