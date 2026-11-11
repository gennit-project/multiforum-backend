import assert from 'node:assert/strict';
import test from 'node:test';
import {buildSchema,graphql} from 'graphql';
import {staticResponsePaths} from './staticResponsePaths.js';
async function capture(source:string,variables:Record<string,unknown>={}){
 const schema=buildSchema('type Query{nodes:[Node!]!} type Node{id:ID! title:String child:Node}');
 let paths:string[]=[];
 schema.getQueryType()!.getFields().nodes.resolve=(_p,_a,_c,info)=>{paths=staticResponsePaths(info);return [];};
 return {result:await graphql({schema,source,variableValues:variables}),get paths(){return paths;}};
}
test('fixed projection paths preserve aliases, fragments and merged nested selections',async()=>{
 const {result,paths}=await capture('query{nodes{id ...Fields child{id} child{title}}} fragment Fields on Node{label:title child{... on Node{key:id}}}');
 assert.equal(result.errors,undefined);assert.deepEqual(paths,['child.id','child.key','child.title','id','label']);
});
test('conditional selections cannot silently become required projection fields',async()=>{
 for(const show of [true,false]){const {result}=await capture('query($show:Boolean!){nodes{id title @include(if:$show)}}',{show});assert.match(result.errors?.[0].message??'',/Conditional selections/);}
});
test('root directives cannot silently certify a conditional repository result',async()=>{
 const {result}=await capture('query{nodes @include(if:true){id}}');assert.match(result.errors?.[0].message??'',/Conditional root/);
});
