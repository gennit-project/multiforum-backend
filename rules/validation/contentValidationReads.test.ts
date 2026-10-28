import assert from "node:assert/strict";
import test from "node:test";
import { allow } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import { updateDownloadableFileInputIsValid } from "./downloadableFileIsValid.js";
import { validateDiscussionImagePreferences } from "./discussionIsValid.js";
const options = {debug:false,allowExternalErrors:true,fallbackRule:allow,hashFunction:JSON.stringify};
const info={} as GraphQLResolveInfo;
const makeContext = (files: unknown[] = [{id:"file",fileName:"old.zip"}]) => {
 const calls: unknown[]=[];
 const ctx:any={_shield:{cache:{}},
  ogm:{model:()=>{throw new Error("Unexpected OGM acquisition");}},
  contentValidationRepository:{findExistingDownloadableFiles:async(where:unknown)=>{calls.push(where);return files;},findDiscussionChannels:async(where:unknown)=>{calls.push(where);return [{DiscussionChannels:[{channelUniqueName:"cats"},{channelUniqueName:"cats"}]}];}},
  contentFeaturePolicyRepository:{findServerFileTypePolicy:async()=>({allowedFileTypes:["zip"]}),findChannelPolicy:async(name:string)=>{calls.push(name);return {found:true,imageUploadsEnabled:true,downloadsEnabled:true,allowedFileTypes:["zip"]};}},
 };
 return {ctx,calls};
};
for (const fileName of [undefined,"", "new.zip"]) test(`update validation preserves filename fallback ${JSON.stringify(fileName)}`,async()=>{
 const {ctx,calls}=makeContext(); const where={OR:[{id:"file"},{fileName_CONTAINS:"old"}]};
 assert.equal(await updateDownloadableFileInputIsValid.resolve({}, {where,update:{fileName}},ctx,info,options),true);
 assert.deepEqual(calls,[where]);
});
test("new filename is validated instead of existing filename",async()=>{
 const {ctx}=makeContext();
 assert.equal((await updateDownloadableFileInputIsValid.resolve({}, {where:{id:"file"},update:{fileName:{set:"new.exe"}}},ctx,info,options) as Error).message,"File type 'exe' is not allowed by server configuration. Allowed types: zip");
});
test("missing file and failed lookup retain their failure strings",async()=>{
 const {ctx}=makeContext([]);
 assert.equal((await updateDownloadableFileInputIsValid.resolve({}, {where:{id:"missing"},update:{fileName:"x.zip"}},ctx,info,options) as Error).message,"File not found");
 ctx._shield.cache={};
 ctx.contentValidationRepository.findExistingDownloadableFiles=async()=>{throw new Error("lookup failure");};
 assert.equal((await updateDownloadableFileInputIsValid.resolve({}, {where:{id:"failed"},update:{fileName:"x.zip"}},ctx,info,options) as Error).message,"Failed to validate file update");
});
test("discussion filter is forwarded and channel preference checks stay deduplicated",async()=>{
 const {ctx,calls}=makeContext(); const where={title_CONTAINS:"topic"};
 assert.equal(await validateDiscussionImagePreferences({where,discussionInput:{Album:{create:[{node:{Images:{connect:[{where:{node:{id:"image"}}}]}}}]}}},ctx),true);
 assert.deepEqual(calls,[where,"cats"]);
});
test("missing discussion filter avoids lookup and retains missing-channel error",async()=>{
 const {ctx,calls}=makeContext();
 assert.equal(await validateDiscussionImagePreferences({where:{},discussionInput:{Album:{create:[{node:{Images:{connect:[{}]}}}]}}},ctx),"No channel specified for this operation.");
 assert.deepEqual(calls,[]);
});
