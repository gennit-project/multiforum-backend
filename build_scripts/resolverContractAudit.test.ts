import assert from "node:assert/strict";
import {Kind,type TypeNode} from "graphql";
import typeDefs from "../typeDefs.js";
import {sharedListSources} from "../tests/helpers/sharedListSources.js";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { allResolverFields } from "./resolverContractInventory.js";
import { checkedResolverFields } from "../customResolvers/contracts/registry.js";
import { votingMutationNames } from "../customResolvers/contracts/voting.js";
import { subscriptionMutationNames } from "../customResolvers/contracts/subscriptions.js";
import { reactionMutationNames } from "../customResolvers/contracts/reactions.js";

type Audit = { field: string; selectedPaths: string[]; residualPaths: string[]; evidence: unknown; reason: string; decision: string | null; disposition?: string };
function evidencePaths(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(evidencePaths);
  if (value && typeof value === "object") return Object.values(value).flatMap(evidencePaths);
  return [];
}
test("campaign audit accounts for every remaining field and does not promote unexplained raw results", () => {
  const baseline = [...votingMutationNames, ...subscriptionMutationNames, ...reactionMutationNames].map(name => `Mutation.${name}`);
  const rows = readdirSync("docs/resolver-contract-audit").filter(file => file.endsWith(".json")).flatMap(file => {
    const audit = JSON.parse(readFileSync(`docs/resolver-contract-audit/${file}`, "utf8")) as { fields?: Audit[]; entries?: Audit[] };
    return audit.fields ?? audit.entries ?? [];
  });
  assert.equal(new Set(rows.map(row => row.field)).size, rows.length, "duplicate audit ownership");
  assert.deepEqual(rows.map(row => row.field).sort(), allResolverFields().filter(field => !baseline.includes(field)));
  for (const row of rows) {
    assert.ok(row.reason.trim(), `${row.field}: reason required`);
    assert.equal(row.selectedPaths.length > 0, checkedResolverFields.includes(row.field), `${row.field}: selected paths must match actual checked registration`);
    if (!checkedResolverFields.includes(row.field)) {
      assert.ok(row.residualPaths.length, `${row.field}: unresolved output must be named`);
      assert.ok(row.decision?.trim(), `${row.field}: next decision/work must be explicit`);
    }
    const paths = evidencePaths(row.evidence);
    assert.ok(paths.length, `${row.field}: evidence required`);
    for (const path of paths) assert.ok(existsSync(path.replace(/:\d+$/, "")), `${row.field}: missing evidence ${path}`);
  }
});

test('every deferred boundary has a finite disposition tied to its current contract',()=>{
 const sourceFields=new Set(sharedListSources.map(row=>`${row.parent}.${row.field}`));
 const rawFields=new Set(['DiscussionChannelListItem.Flairs','ScratchpadEntry.superUpvotedByUsers','SiteWideDiscussionListItem.DownloadableFiles','Query.getImageAlbumUsage']);
 const named=(type:TypeNode):string=>type.kind===Kind.NAMED_TYPE?type.name.value:named(type.type);
 function isJsonBoundary(field:string):boolean{
  if(field==='JSON')return typeDefs.definitions.some(node=>node.kind===Kind.SCALAR_TYPE_DEFINITION&&node.name.value==='JSON');
  const [parent,key]=field.split('.');
  const definition=typeDefs.definitions.find(node=>node.kind===Kind.OBJECT_TYPE_DEFINITION&&node.name.value===parent);
  if(definition?.kind!==Kind.OBJECT_TYPE_DEFINITION)return false;
  const output=definition.fields?.find(node=>node.name.value===key);
  return !!output&&named(output.type)==='JSON';
 }
 const counts:Record<string,number>={};
 for(const file of readdirSync('docs/resolver-contract-audit').filter(file=>file.endsWith('.json'))){
  const audit=JSON.parse(readFileSync(`docs/resolver-contract-audit/${file}`,'utf8')) as {fields?:Audit[];entries?:Audit[]};
  for(const row of audit.fields??audit.entries??[]){
   if(checkedResolverFields.includes(row.field)){assert.equal(row.disposition,undefined,row.field);continue;}
   const expected=isJsonBoundary(row.field)?'schema-limit':sourceFields.has(row.field)?'source-migration':rawFields.has(row.field)?'raw-scalar-limit':row.field==='Mutation.addIssueActivityFeedItem'?'upstream-runtime-limit':undefined;
   assert.ok(expected,`${row.field}: no justified disposition; add a concrete work gate`);
   assert.equal(row.disposition,expected,`${row.field}: do not hide unfinished source work as a schema limit`);
   counts[expected]=(counts[expected]??0)+1;
  }
 }
 assert.deepEqual(counts,{'schema-limit':6,'source-migration':18,'raw-scalar-limit':4,'upstream-runtime-limit':1});
});
