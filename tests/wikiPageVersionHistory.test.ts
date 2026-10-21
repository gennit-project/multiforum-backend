import test from "node:test";
import assert from "node:assert/strict";
import { wikiPageVersionHistoryHandler } from "../hooks/wikiPageVersionHistoryHook.js";

test("wiki page revision history copies the replaced version's edit reason", async () => {
  const createdTextVersions: Array<any> = [];
  const wikiPageUpdates: Array<any> = [];

  const WikiPageModel = {
    find: async () => [
      {
        id: "wiki-1",
        title: "Current title",
        body: "Current body",
        editReason: "Clarified setup steps",
        VersionAuthor: { username: "wiki-editor" },
        PastVersions: [],
      },
    ],
    update: async (input: any) => {
      wikiPageUpdates.push(input);
      return { wikiPages: [{ id: "wiki-1" }] };
    },
  };

  const TextVersionModel = {
    create: async (input: any) => {
      createdTextVersions.push(input);
      return { textVersions: [{ id: "version-1" }] };
    },
  };

  const UserModel = {
    find: async () => [{ username: "wiki-editor" }],
  };

  const context = {
    wikiRevisionRepository: {
      findSnapshot: () => WikiPageModel.find(), findAuthor: () => UserModel.find(),
      createRevision: (input:any) => TextVersionModel.create({input:[input]}),
      findPageId: () => WikiPageModel.find(),
      connectRevision: (id:string,revisionId:string) => WikiPageModel.update({where:{id},update:{PastVersions:{connect:[{where:{node:{id:revisionId}}}]}}}),
    },
    ogm: {
      model: (name: string) => {
        if (name === "WikiPage") return WikiPageModel;
        if (name === "TextVersion") return TextVersionModel;
        if (name === "User") return UserModel;
        throw new Error(`Unexpected model ${name}`);
      },
    },
  };

  await wikiPageVersionHistoryHandler({
    context,
    params: {
      where: { id: "wiki-1" },
      update: {
        body: "Updated body",
        editReason: "New edit reason",
      },
    },
  } as unknown as Parameters<typeof wikiPageVersionHistoryHandler>[0]);

  assert.equal(createdTextVersions.length, 1);
  assert.deepEqual(createdTextVersions[0].input[0], {
    body: "Current body",
    editReason: "Clarified setup steps",
    Author: {
      connect: { where: { node: { username: "wiki-editor" } } },
    },
  });
  assert.equal(
    wikiPageUpdates[0].update.PastVersions.connect[0].where.node.id,
    "version-1"
  );
});

function recordingWiki(options:{title?:string;body?:string|null;reason?:string|null;author?:string|null;fail?:string;missingParent?:boolean}={}){
 const calls:string[]=[];const inputs:any[]=[];const record=(x:string)=>{calls.push(x);if(x===options.fail)throw Error(x);};
 const context:any={user:{username:'current-user'},wikiRevisionRepository:{
 findSnapshot:async()=>{record('snapshot');return [{id:'w',title:options.title??'Title',body:options.body===undefined?'Body':options.body,editReason:options.reason,VersionAuthor:{username:options.author===undefined?'previous':options.author}}];},
 findAuthor:async(username:string)=>{record(`author:${username}`);return [{username}];},
 createRevision:async(input:any)=>{inputs.push(input);record(`create:${input.body}`);return {textVersions:[{id:input.body}]};},
 findPageId:async()=>{record('parent');return options.missingParent?[]:[{id:'w'}];},
 connectRevision:async(_id:string,revisionId:string)=>record(`connect:${revisionId}`),
 }};return {context,calls,inputs};
}
const wikiParams={where:{id:'w'},update:{title:'New',body:'New'}};
test('wiki uses previous VersionAuthor, old truthy edit reason and title-before-body independent catches',async()=>{
 const {context,calls,inputs}=recordingWiki({reason:'old reason',fail:'connect:Title'});
 await wikiPageVersionHistoryHandler({context,params:wikiParams});
 assert.deepEqual(calls,['snapshot','author:previous','create:Title','parent','connect:Title','author:previous','create:Body','parent','connect:Body']);
 for(const input of inputs){assert.equal(input.editReason,'old reason');assert.equal(input.Author.connect.where.node.username,'previous');}
});
test('wiki skips empty previous content and absent version author; does not fall back to current user',async()=>{
 for(const options of [{title:'',body:''},{author:null}]){const {context,calls}=recordingWiki(options);await wikiPageVersionHistoryHandler({context,params:wikiParams});assert.deepEqual(calls,['snapshot']);}
});
test('wiki missing parent leaves both created versions and omits empty edit reason',async()=>{
 const {context,calls,inputs}=recordingWiki({missingParent:true,reason:''});await wikiPageVersionHistoryHandler({context,params:wikiParams});
 assert.equal(inputs.length,2);for(const input of inputs)assert.equal(Object.prototype.hasOwnProperty.call(input,'editReason'),false);assert.ok(!calls.some(x=>x.startsWith('connect:')));
});
