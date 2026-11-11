import sourceIdentity from "../../middleware/userChildIdentityMiddleware.js";
import assert from "node:assert/strict";
import { after, before, beforeEach, mock, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { graphql, type GraphQLObjectType, type GraphQLSchema } from "graphql";
import { applyMiddleware } from "graphql-middleware";
import { Storage } from "@google-cloud/storage";
import type { Driver } from "neo4j-driver";
import typeDefs from "../../typeDefs.js";
import getResolvers from "../helpers/getTestResolvers.js";
import permissions from "../../permissions.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { createDownloadReviewRepository } from "../../services/persistence/downloadReviewRepository.js";
import { createDownloadLabelRepository } from "../../services/persistence/downloadLabelRepository.js";
import prepareDownload from "../../customResolvers/mutations/prepareDownload.js";
import updateDownloadLabels from "../../customResolvers/mutations/updateDownloadLabels.js";
import { denyExternalHttp } from "../denyExternalHttp.js";
import { startNeo4j, stopNeo4j, resetDatabase } from "./neo4jHarness.js";

let driver: Driver, schema: GraphQLSchema, secured: GraphQLSchema;
let guard: ReturnType<typeof denyExternalHttp>;
let calls:string[]=[];
let scanMode:"clean"|"held"|"missing"|"unconfigured"|"error"="clean";
let failure:"read"|"sign"|"track"|"history"|""="";
let signedUrl="https://signed.example.invalid/file.zip";
const now="2026-07-19T12:00:00.000Z";
before(async()=>{
  driver=await startNeo4j();
  const storage=new Storage({projectId:"fixture-project"});
  const bucket=storage.bucket("fixture-bucket"),file=bucket.file("fixture-object");
  mock.method(storage,"bucket",()=>bucket);mock.method(bucket,"file",()=>file);
  mock.method(file,"getSignedUrl",async()=>{calls.push("sign");if(failure==="sign")throw new Error("injected signing failure");return [signedUrl];});
  const review=createDownloadReviewRepository(driver),labels=createDownloadLabelRepository(driver);
  const prepare=prepareDownload({driver,agePolicyRepository:{findAgePolicyConfigs:async()=>[]},downloadReviewRepository:{...review,findPreparation:async id=>{calls.push("read");if(failure==="read")throw new Error("injected read failure");return review.findPreparation(id);}}},
    async()=>{
      calls.push("scan");if(scanMode==="error")throw new Error("injected scan failure");
      if(scanMode==="unconfigured")return [];
      if(scanMode==="missing")await driver.executeQuery("MATCH(f:DownloadableFile) DETACH DELETE f");
      else await driver.executeQuery("MATCH(f:DownloadableFile) SET f.scanStatus=$status,f.scanCheckedAt=datetime($now)",{status:scanMode==="held"?"SUSPICIOUS":"CLEAN",now});
      return [{pluginId:"security-attachment-scan",status:"SUCCEEDED"}];
    },async()=>{calls.push("permission");return false;},()=>storage,async()=>{calls.push("track");if(failure==="track")throw new Error("injected tracking failure");return true;},
    {now:()=>new Date(now),scanCacheTtlMs:15*60*1000});
  const labelResolver=updateDownloadLabels({driver,downloadLabelRepository:{...labels,createHistory:async input=>{calls.push("history");if(failure==="history")throw new Error("injected history failure");await labels.createHistory(input);}}});
  const app=getResolvers(driver);
  schema=await new Neo4jGraphQL({driver,typeDefs,resolvers:{...app.resolvers,Mutation:{...app.resolvers.Mutation,prepareDownload:prepare,updateDownloadLabels:labelResolver}},features:{filters:{String:{MATCHES:true}}}}).getSchema();
  registerGeneratedSchema(driver,schema);secured=applyMiddleware(schema,permissions,sourceIdentity);guard=denyExternalHttp();
},{timeout:240000});
after(async()=>{guard?.assertUnused();guard?.restore();mock.restoreAll();await stopNeo4j();});
beforeEach(async()=>{
  await resetDatabase(driver);calls=[];scanMode="clean";failure="";signedUrl="https://signed.example.invalid/file.zip";
  await driver.executeQuery(`CREATE(u:User {username:'owner',createdAt:datetime()}),(:User {username:'viewer',createdAt:datetime()}),
   (ch:Channel {uniqueName:'forum',createdAt:datetime()}),
   (d:Discussion {id:'d',title:'Download',hasSensitiveContent:false,createdAt:datetime()}),
   (dc:DiscussionChannel {id:'dc',discussionId:'d',channelUniqueName:'forum',createdAt:datetime()}),
   (f:DownloadableFile {id:'f',fileName:'file.zip',url:'https://example.invalid/file.zip',storageBucket:'fixture-bucket',storageObjectName:'fixture-object',uploadedByUsername:'owner',scanStatus:'CLEAN',scanCheckedAt:datetime($now),scanReason:'private detail',createdAt:datetime()}),
   (g:FilterGroup {id:'g',key:'size',displayName:'Size',order:1,mode:'INCLUDE',uploadSelection:'MULTIPLE'}),
   (a:FilterOption {id:'a',value:'small',displayName:'Small',order:1}),(b:FilterOption {id:'b',value:'large',displayName:'Large',order:2})
   CREATE(u)-[:POSTED_DISCUSSION]->(d) CREATE(dc)-[:POSTED_IN_CHANNEL]->(d) CREATE(dc)-[:POSTED_IN_CHANNEL]->(ch)
   CREATE(d)-[:HAS_DOWNLOADABLE_FILE]->(f) CREATE(g)-[:HAS_FILTER_OPTION]->(a) CREATE(g)-[:HAS_FILTER_OPTION]->(b) CREATE(dc)-[:HAS_LABEL_OPTION]->(a)`,{now});
});
function execute(source:string,username:string|null="viewer",sensitive=false){return graphql({schema:secured,source:`mutation {${source}}`,contextValue:{driver,req:{headers:{}},mayAccessSensitiveContent:sensitive,user:username?{username,email:null,email_verified:true,data:{ModerationProfile:null}}:undefined}});}
const preparedFields="ready url scanStatus scanReason scanCheckedAt reviewAccess message";
const prepareSource=(id="f",discussion="d")=>`prepareDownload(downloadableFileId:${JSON.stringify(id)},discussionId:${JSON.stringify(discussion)}){${preparedFields}}`;
const plain=(value:unknown)=>JSON.parse(JSON.stringify(value));
const labelSource=(ids:string[])=>`updateDownloadLabels(discussionId:"d",channelUniqueName:"forum",labelOptionIds:${JSON.stringify(ids)}){id LabelOptions{id value displayName order group{id key displayName}}}`;
async function labelIds(){return (await driver.executeQuery("MATCH(:DiscussionChannel)-[:HAS_LABEL_OPTION]->(l:FilterOption) RETURN l.id AS id ORDER BY id")).records.map(r=>r.get("id"));}

test("fresh clean download serializes complete response, hides private reason and signs before tracking",async()=>{
 const result=await execute(prepareSource());assert.equal(result.errors,undefined);
 assert.deepEqual(plain(result.data),{prepareDownload:{ready:true,url:signedUrl,scanStatus:"CLEAN",scanReason:null,scanCheckedAt:now,reviewAccess:false,message:"No threats found. Your download is ready."}});
 assert.deepEqual(calls,["read","permission","sign","track"]);
});
test("stale scan rereads before signing; held viewer is blocked while creator receives review access",async()=>{
 await driver.executeQuery("MATCH(f:DownloadableFile) REMOVE f.scanCheckedAt");
 let result=await execute(prepareSource());assert.equal(result.errors,undefined);assert.equal(plain(result.data).prepareDownload.ready,true);assert.deepEqual(calls,["read","permission","scan","read","sign","track"]);
 calls=[];scanMode="held";await driver.executeQuery("MATCH(f:DownloadableFile) REMOVE f.scanCheckedAt");
 result=await execute(prepareSource());assert.equal(result.errors,undefined);assert.deepEqual(plain(result.data).prepareDownload,{ready:false,url:null,scanStatus:"SUSPICIOUS",scanReason:null,scanCheckedAt:now,reviewAccess:false,message:"This download was blocked by the security check."});assert.deepEqual(calls,["read","permission","scan","read"]);
 calls=[];result=await execute(prepareSource(),"owner");assert.equal(result.errors,undefined);const reviewed=plain(result.data).prepareDownload;assert.equal(reviewed.ready,true);assert.equal(reviewed.reviewAccess,true);assert.equal(reviewed.scanReason,"private detail");assert.equal(reviewed.url,signedUrl);assert.deepEqual(calls,["read","scan","read","sign","track"]);
});
test("missing, mismatched, restricted and anonymous requests never invoke the scanner or signer",async()=>{
 for(const source of [prepareSource("missing"),prepareSource("f","wrong")]){calls=[];assert.ok((await execute(source)).errors);assert.deepEqual(calls,["read"]);}
 calls=[];assert.ok((await execute(prepareSource(),null)).errors);assert.deepEqual(calls,[]);
 await driver.executeQuery("MATCH(d:Discussion) SET d.hasSensitiveContent=true");calls=[];assert.ok((await execute(prepareSource())).errors);assert.deepEqual(calls,["read"]);
});
test("scanner absence, disappearance and failures preserve result/error order",async()=>{
 await driver.executeQuery("MATCH(f:DownloadableFile) REMOVE f.scanCheckedAt");scanMode="unconfigured";
 let result=await execute(prepareSource());assert.equal(result.errors,undefined);assert.equal(plain(result.data).prepareDownload.scanStatus,"FAILED");assert.equal(plain(result.data).prepareDownload.ready,false);assert.deepEqual(calls,["read","permission","scan"]);
 calls=[];scanMode="error";result=await execute(prepareSource());assert.match(result.errors?.[0].message??"",/injected scan failure/);assert.deepEqual(calls,["read","permission","scan"]);
 calls=[];scanMode="missing";result=await execute(prepareSource());assert.match(result.errors?.[0].message??"",/no longer exists/);assert.deepEqual(calls,["read","permission","scan","read"]);
});
test("sign/read/track errors and empty URL retain no-later-work boundaries",async()=>{
 for(const [stage,expected] of [["read",["read"]],["sign",["read","permission","sign"]],["track",["read","permission","sign","track"]]] as const){failure=stage;calls=[];assert.ok((await execute(prepareSource())).errors);assert.deepEqual(calls,expected);}
 failure="";calls=[];signedUrl="";const result=await execute(prepareSource());assert.equal(result.errors,undefined);assert.equal(plain(result.data).prepareDownload.ready,false);assert.equal(plain(result.data).prepareDownload.url,null);assert.deepEqual(calls,["read","permission","sign"]);
});
test("invalid persisted scan enum fails generated read before permission/scanner/signing",async()=>{
 await driver.executeQuery("MATCH(f:DownloadableFile) SET f.scanStatus='UNKNOWN'");const result=await execute(prepareSource());assert.match(result.errors?.[0].message??"",/ScanStatus/);assert.deepEqual(calls,["read"]);
});
test("labels serialize exact nested projection, repeat and clear; history records preserve update order",async()=>{
 const result=await execute(labelSource(["b"]),"owner");assert.equal(result.errors,undefined);assert.deepEqual(plain(result.data),{updateDownloadLabels:{id:"dc",LabelOptions:[{id:"b",value:"large",displayName:"Large",order:2,group:{id:"g",key:"size",displayName:"Size"}}]}});assert.deepEqual(await labelIds(),["b"]);assert.deepEqual(calls,["history","history"]);
 calls=[];assert.equal((await execute(labelSource(["b"]),"owner")).errors,undefined);assert.deepEqual(calls,[]);
 const empty=await execute(labelSource([]),"owner");assert.equal(empty.errors,undefined);assert.deepEqual(plain(empty.data),{updateDownloadLabels:{id:"dc",LabelOptions:[]}});assert.deepEqual(await labelIds(),[]);
});
test("history failure is swallowed after label update commits",async()=>{
 failure="history";const result=await execute(labelSource(["b"]),"owner");assert.equal(result.errors,undefined);assert.equal(plain(result.data).updateDownloadLabels.LabelOptions[0].id,"b");assert.deepEqual(await labelIds(),["b"]);assert.deepEqual(calls,["history"]);
});
test("label authentication, target lookup and single-selection validation reject before update",async()=>{
 assert.ok((await execute(labelSource(["b"]),null)).errors);assert.ok((await execute(labelSource(["b"]),"viewer")).errors);assert.deepEqual(await labelIds(),["a"]);
 await driver.executeQuery("MATCH(g:FilterGroup) SET g.uploadSelection='SINGLE'");assert.match((await execute(labelSource(["a","b"]),"owner")).errors?.[0].message??"",/only one label/);assert.deepEqual(await labelIds(),["a"]);assert.deepEqual(calls,[]);
 assert.match((await execute('updateDownloadLabels(discussionId:"missing",channelUniqueName:"forum",labelOptionIds:[]){id}',"owner")).errors?.[0].message??"",/Discussion not found/);
});
test("label nullable group and selected-field failure retain post-write serialization behavior",async()=>{
 await driver.executeQuery("MATCH(:FilterGroup)-[r:HAS_FILTER_OPTION]->(b:FilterOption {id:'b'}) DELETE r");
 const nullable=await execute(labelSource(["b"]),"owner");assert.equal(nullable.errors,undefined);assert.equal(plain(nullable.data).updateDownloadLabels.LabelOptions[0].group,null);
 assert.equal((await execute(labelSource(["a"]),"owner")).errors,undefined);calls=[];
 // order is selected only after the update, not in the validation reads.
 const field=(schema.getType("FilterOption") as GraphQLObjectType).getFields().order,original=field.resolve;
 field.resolve=()=>{throw new Error("injected label projection failure");};
 try {
  const result=await execute(labelSource(["b"]),"owner");assert.match(result.errors?.[0].message??"",/injected label projection failure/);assert.deepEqual(await labelIds(),["b"]);assert.deepEqual(calls,[]);
 } finally {field.resolve=original;}
});

test('prepared download aliases preserve readiness and signed URL without exposing scan reason',async()=>{
 const response=await execute('result:prepareDownload(downloadableFileId:"f",discussionId:"d"){ready:url url:ready reason:scanReason}');
 assert.equal(response.errors,undefined,JSON.stringify(response.errors));assert.deepEqual(plain(response.data).result,{ready:signedUrl,url:true,reason:null});
});
test('download label fixed result preserves option and group collisions',async()=>{
 const response=await execute('result:updateDownloadLabels(discussionId:"d",channelUniqueName:"forum",labelOptionIds:["b"]){key:id LabelOptions{id:value value:id group{id:key key:id}}}','owner');
 assert.equal(response.errors,undefined,JSON.stringify(response.errors));assert.deepEqual(plain(response.data).result,{key:'dc',LabelOptions:[{id:'large',value:'b',group:{id:'size',key:'g'}}]});
 assert.deepEqual(await labelIds(),['b']);
});
