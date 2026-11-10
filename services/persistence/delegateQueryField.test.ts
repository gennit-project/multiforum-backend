import assert from 'node:assert/strict';
import test from 'node:test';
import {buildSchema,graphql,isObjectType,isUnionType,GraphQLError} from 'graphql';
import type {ExecutionResult,GraphQLResolveInfo} from 'graphql';
import {defaultMergedResolver} from '@graphql-tools/delegate';
import {delegateQueryField} from './delegateQueryField.js';

const sdl=`type Query { issues: [Issue] }
type Issue { id: ID! title: String number: Int required: String! author: Author }
union Author = User | ModerationProfile
type User { username: String! } type ModerationProfile { displayName: String }`;
function setup(rows:unknown){
 const target=buildSchema(sdl),outer=buildSchema(sdl),context={marker:'owned context'};
 // Delegated response keys require a consuming resolver that understands them.
 // Production uses Neo4j's response-key-aware field resolvers; this isolated
 // fixture uses the library's equivalent, not GraphQL's source-name default.
 for(const name of ['Issue','User','ModerationProfile']) {
  const type=outer.getType(name);assert.ok(isObjectType(type));
  for(const field of Object.values(type.getFields()))field.resolve=defaultMergedResolver;
 }
 const query=target.getQueryType(),outerQuery=outer.getQueryType();
 assert.ok(query);assert.ok(outerQuery);
 let reads=0;
 query.getFields().issues.resolve=(_parent,_args,ctx)=>{reads++;assert.equal(ctx,context);return rows;};
 outerQuery.getFields().issues.resolve=(_parent,_args,_ctx,info)=>delegateQueryField({schema:target,fieldName:'issues',args:{},context,info});
 return {target,outer,context,query,outerQuery,reads:()=>reads,
  run:(source:string,variableValues?:Record<string,unknown>)=>graphql({schema:outer,source,variableValues})};
}
const plain=(value:unknown)=>JSON.parse(JSON.stringify(value));

test('delegated selected scalars are completed by the actual target schema',async()=>{
 const x=setup([{id:42,title:17,number:'8'}]);
 const result=await x.run('{ rows:issues { key:id title number } }');
 assert.equal(result.errors,undefined);
 assert.deepEqual(plain(result.data),{rows:[{key:'42',title:'17',number:8}]});
 assert.equal(x.reads(),1);
});

test('delegation preserves fragments, variables and laziness for unrequested invalid fields',async()=>{
 const x=setup([{id:'one',title:['invalid'],number:2}]);
 const issue=x.target.getType('Issue');assert.ok(isObjectType(issue));
 let titleReads=0;issue.getFields().title.resolve=()=>{titleReads++;return ['invalid'];};
 const source='query($show:Boolean!){rows:issues{...Fields bad:title @include(if:$show)}} fragment Fields on Issue { key:id number }';
 const skipped=await x.run(source,{show:false});
 assert.equal(skipped.errors,undefined);assert.equal(titleReads,0);
 assert.deepEqual(plain(skipped.data),{rows:[{key:'one',number:2}]});
 const selected=await x.run(source,{show:true});
 assert.equal(titleReads,1);assert.equal(selected.errors?.length,1);
 assert.deepEqual(selected.errors?.[0].path,['rows',0,'bad']);
 assert.deepEqual(plain(selected.data),{rows:[{key:'one',number:2,bad:null}]});
});

test('delegated selected non-null failures bubble only to their nullable item',async()=>{
 const x=setup([{id:'bad',required:null},{id:'good',required:'ok'}]);
 const result=await x.run('{ rows:issues { key:id must:required } }');
 assert.equal(result.errors?.length,1);
 assert.deepEqual(result.errors?.[0].path,['rows',0,'must']);
 assert.deepEqual(plain(result.data),{rows:[null,{key:'good',must:'ok'}]});
});

test('delegated abstract types use target resolution and preserve nullable moderator fields',async()=>{
 const x=setup([{id:'one',author:{kind:'moderator',displayName:null}}]);
 const author=x.target.getType('Author');assert.ok(isUnionType(author));
 author.resolveType=()=> 'ModerationProfile';
 const result=await x.run('{ rows:issues { author { kind:__typename ... on ModerationProfile { label:displayName } ... on User { username } } } }');
 assert.equal(result.errors,undefined);
 assert.deepEqual(plain(result.data),{rows:[{author:{kind:'ModerationProfile',label:null}}]});
});

test('delegated root errors retain aliases and error extensions',async()=>{
 const x=setup([]);
 x.query.getFields().issues.resolve=()=>{throw new GraphQLError('target failed',{extensions:{code:'TARGET_FAILURE'}});};
 const result=await x.run('{ rows:issues { id } }');
 assert.deepEqual(plain(result.data),{rows:null});
 assert.equal(result.errors?.length,1);
 assert.deepEqual(result.errors?.[0].path,['rows']);
 assert.equal(result.errors?.[0].extensions.code,'TARGET_FAILURE');
});

test('skipped delegation performs no target execution',async()=>{
 const x=setup([]);
 const result=await x.run('{ issues @skip(if:true) { id } }');
 assert.equal(result.errors,undefined);assert.equal(x.reads(),0);
});

test('query-only adapter does not forward undeclared result transforms',async()=>{
 const x=setup([{id:'original'}]);let transforms=0;
 x.outerQuery.getFields().issues.resolve=(_parent,_args,_ctx,info:GraphQLResolveInfo)=>{
  const options={schema:x.target,fieldName:'issues' as const,args:{},context:x.context,info,
   transforms:[{transformResult(result:ExecutionResult){transforms++;return result;}}]};
  return delegateQueryField(options);
 };
 const result=await x.run('{ issues { id } }');
 assert.equal(result.errors,undefined);
 assert.deepEqual(plain(result.data),{issues:[{id:'original'}]});
 assert.equal(transforms,0);
});

test('delegated nullable root and item values remain nullable',async()=>{
 for(const rows of [null,[null]]){
  const result=await setup(rows).run('{ issues { id } }');
  assert.equal(result.errors,undefined);assert.deepEqual(plain(result.data),{issues:rows});
 }
});

test('delegation rejects a non-list target result rather than certifying its container',async()=>{
 const result=await setup({id:'not-a-list'}).run('{ rows:issues { id } }');
 assert.equal(result.errors?.length,1);assert.deepEqual(result.errors?.[0].path,['rows']);
 assert.deepEqual(plain(result.data),{rows:null});
});
