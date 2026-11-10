import assert from 'node:assert/strict';
import test from 'node:test';
import {buildSchema,graphql,execute,Kind} from 'graphql';
import {withDelegatedSourceMetadata,sourceMetadataRecorder} from './delegatedSourceMetadata.js';
import {rememberAccountChildIdentity,accountChildIdentity} from './accountChildIdentity.js';
import {rememberAuthorSourceType,authorSourceType} from './authorSourceType.js';

const schema=buildSchema('type Query{issues:[Issue] other:[Issue]} type Issue{actor:Actor id:ID!} type Actor{id:ID!}');
async function read(context:Record<string,unknown>,identity:unknown,fail=false){
 const raw={id:'actor'};
 rememberAccountChildIdentity(raw,identity);rememberAuthorSourceType(raw,'ModerationProfile');
 return graphql({schema,source:'{issues{id who:actor{id}}}',contextValue:context,rootValue:{issues:(_args:unknown,ctx:unknown,info:import('graphql').GraphQLResolveInfo)=>{
  const capture=sourceMetadataRecorder(ctx,info);
  capture?.([0,'who'],raw);capture?.([1,'missing'],raw); // Null/error branches must remain untouched.
  if(fail)throw new Error('read failed');
  return [{id:'issue',actor:raw},null];
 }}});
}
test('delegated metadata transfers raw identity and author type without adding response fields',async()=>{
 const context={jwt:{mayAccessSensitiveContent:true}};
 const result:unknown=await withDelegatedSourceMetadata(context,'issues',async()=>{
  const result=await read(context,17);assert.equal(result.errors,undefined);return result.data?.issues;
 });
 assert.ok(Array.isArray(result));
 const actor=result[0].who;
 assert.deepEqual(accountChildIdentity(actor),{found:true,value:17});
 assert.deepEqual(authorSourceType(actor),{found:true,value:'ModerationProfile'});
 assert.deepEqual(JSON.parse(JSON.stringify(result)),[{id:'issue',who:{id:'actor'}},null]);
 assert.deepEqual(context,{jwt:{mayAccessSensitiveContent:true}});
 const plain=await read(context,'later');
 assert.ok(Array.isArray(plain.data?.issues));
 assert.deepEqual(accountChildIdentity(plain.data.issues[0].who),{found:false});
});
test('independent delegation contexts do not exchange private source metadata',async()=>{
 const results=await Promise.all(['alice','bob'].map(async identity=>{
  const context={};
  const result:unknown=await withDelegatedSourceMetadata(context,'issues',async()=>{await Promise.resolve();return (await read(context,identity)).data?.issues;});
  assert.ok(Array.isArray(result));return accountChildIdentity(result[0].who);
 }));
 assert.deepEqual(results,[{found:true,value:'alice'},{found:true,value:'bob'}]);
});
test('delegated metadata cleanup preserves thrown read errors and permits later reuse',async()=>{
 const context={};
 await assert.rejects(withDelegatedSourceMetadata(context,'issues',()=>{throw new Error('read failed');}),/read failed/);
 const result:unknown=await withDelegatedSourceMetadata(context,'issues',async()=> (await read(context,'retry')).data?.issues);
 assert.ok(Array.isArray(result));assert.deepEqual(accountChildIdentity(result[0].who),{found:true,value:'retry'});
});
test('scope ignores other roots and rejects overlapping use of one context',async()=>{
 const context={};
 await withDelegatedSourceMetadata(context,'other',async()=>{
  const response=await read(context,'wrong');
  assert.ok(Array.isArray(response.data?.issues));
  assert.deepEqual(accountChildIdentity(response.data.issues[0].who),{found:false});
  await assert.rejects(withDelegatedSourceMetadata(context,'issues',()=>null),/fresh context/);
 });
});
test('nested GraphQL operations cannot replace the outer source capture',async()=>{
 const context={};
 const result:unknown=await withDelegatedSourceMetadata(context,'issues',async()=>{
  const response=await graphql({schema,source:'{issues{who:actor{id}}}',contextValue:context,rootValue:{issues:async(_args:unknown,ctx:unknown,info:import('graphql').GraphQLResolveInfo)=>{
   const raw={id:'outer'};rememberAccountChildIdentity(raw,'outer');
   sourceMetadataRecorder(ctx,info)?.([0,'who'],raw);
   await execute({schema,document:{kind:Kind.DOCUMENT,definitions:[info.operation]},contextValue:context,rootValue:{issues:(_nestedArgs:unknown,nestedContext:unknown,nestedInfo:import('graphql').GraphQLResolveInfo)=>{
    const nested={id:'nested'};rememberAccountChildIdentity(nested,'nested');
    assert.equal(nestedInfo.operation,info.operation);
    assert.equal(sourceMetadataRecorder(nestedContext,nestedInfo),undefined);
    return [{id:'nested-issue',actor:nested}];
   }}});
   return [{id:'issue',actor:raw}];
  }}});
  assert.equal(response.errors,undefined);return response.data?.issues;
 });
 assert.ok(Array.isArray(result));assert.deepEqual(accountChildIdentity(result[0].who),{found:true,value:'outer'});
});
