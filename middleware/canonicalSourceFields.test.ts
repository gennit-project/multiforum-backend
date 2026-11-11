import assert from 'node:assert/strict';
import test from 'node:test';
import {buildSchema, graphql} from 'graphql';
import {resolveCanonicalSourceField} from './canonicalSourceFields.js';
import {rememberCanonicalSource,hasCanonicalSourceFields} from '../services/canonicalSourceFields.js';
import emptyArrayFallback from '../customResolvers/fields/emptyArrayFallback.js';

for(const marked of [false,true])test(`canonical provenance preserves ${marked?'owned':'generated'} field lookup and request metadata`,async()=>{
 const schema=buildSchema('type Query{field:String}');
 const source:Record<string,string>={field:'canonical',alias:'generated'};
 Object.defineProperty(source,'unselected',{get(){throw new Error('Unselected source was read');}});
 const context={request:'unchanged'};
 if(marked)assert.equal(rememberCanonicalSource(source),source);
 schema.getQueryType()!.getFields().field.resolve=(parent,args,ctx,info)=>resolveCanonicalSourceField((seen,seenArgs,seenContext,view)=>{
  assert.equal(seen,parent);assert.equal(seenArgs,args);assert.equal(seenContext,ctx);
  assert.equal(view.path,info.path);assert.equal(view.fragments,info.fragments);assert.equal(view.variableValues,info.variableValues);
  assert.equal(info.fieldNodes[0].alias?.value,'alias');
  assert.equal(view===info,!marked);
  assert.equal(view.fieldNodes[0].selectionSet,info.fieldNodes[0].selectionSet);
  const node=view.fieldNodes[0];
  return source[node.alias?.value??node.name.value];
 },parent,args,ctx,info);
 const result=await graphql({schema,source:'{alias:field}',rootValue:source,contextValue:context});
 assert.equal(result.errors,undefined,JSON.stringify(result.errors));
 assert.deepEqual(JSON.parse(JSON.stringify(result.data)),{alias:marked?'canonical':'generated'});
 assert.deepEqual(Object.keys(source),['field','alias']);
});
for(const marked of [false,true])test(`list fallback preserves ${marked?'canonical':'response'} keys and null filtering`,async()=>{
 const schema=buildSchema('type Query{Images:[String] Discussions:[String]}');
 const source={Images:['image',null],Discussions:['discussion',null]};
 if(marked)rememberCanonicalSource(source);
 schema.getQueryType()!.getFields().Images.resolve=emptyArrayFallback('Images');
 const result=await graphql({schema,source:'{Discussions:Images}',rootValue:source});
 assert.equal(result.errors,undefined,JSON.stringify(result.errors));
 assert.deepEqual(JSON.parse(JSON.stringify(result.data)),{Discussions:[marked?'image':'discussion']});
 assert.deepEqual(source,{Images:['image',null],Discussions:['discussion',null]});
});
test('canonical provenance does not infer membership from public fields or primitives',()=>{
 for(const value of [null,undefined,'source',1,{canonical:true},{__canonicalSource:true}])assert.equal(hasCanonicalSourceFields(value),false);
});
