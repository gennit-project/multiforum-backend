import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { buildSchema, graphql, Kind, visit, type GraphQLResolveInfo } from "graphql";
import { ownerProtectedUserFields, resolveUsersWithChildIdentity, resolveUpdatedUsersWithChildIdentity, userChildIdentityAtPath } from "./userChildIdentityMiddleware.js";
import { accountChildIdentity } from "../services/accountChildIdentity.js";
import type { GraphQLContext } from "../types/context.js";

const schema = buildSchema('type Query { users: [User] } type User { username: String bio: String Email: String }');
const context = {} as GraphQLContext;
async function execute(source: string, result: unknown, capture: (info: GraphQLResolveInfo) => void = () => {}) {
  return graphql({ schema, source, contextValue: context, rootValue: {
    users: (args: Record<string, unknown>, ctx: GraphQLContext, info: GraphQLResolveInfo) =>
      resolveUsersWithChildIdentity((_parent, _args, _ctx, selected) => { capture(selected); return result; }, null, args, ctx, info),
  } });
}
test('identity dependencies match all User fields directly guarded by account ownership', () => {
  const source = ts.createSourceFile('permissions.ts', readFileSync(new URL('../permissions.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const fields: string[] = [];
  function scan(node: ts.Node): void {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'User' && ts.isObjectLiteralExpression(node.initializer)) {
      for (const property of node.initializer.properties) if (ts.isPropertyAssignment(property) && property.initializer.getText(source) === 'isAccountOwner') fields.push(property.name.getText(source));
    }
    ts.forEachChild(node, scan);
  }
  scan(source);
  assert.deepEqual([...ownerProtectedUserFields].sort(), fields.sort());
});
test('skipped private selections do not fetch identity or eagerly inspect child values', async () => {
  const row = { bio: 'public' };
  const result = await execute('query($hide:Boolean=true){users{bio ...Private @skip(if:$hide)}} fragment Private on User {Email}', [row], info => {
    assert.equal(info.fieldNodes[0].selectionSet?.selections.length, 2);
  });
  assert.equal(result.errors, undefined);
  assert.deepEqual(accountChildIdentity(row), {found:false});
});
test('selected raw identity remains unknown and missing identities are recorded without falling back to aliases', async () => {
  for (const value of [null, 7, { forged: true }, undefined]) {
    const row: Record<string, unknown> = { username: 'forged' };
    await execute('{users{username:bio Email}}', [row], info => {
      const selections=info.fieldNodes[0].selectionSet!.selections;
      const dependency=selections[selections.length-1];
      assert.equal(dependency.kind,Kind.FIELD);
      if (dependency.kind===Kind.FIELD) row[dependency.alias!.value]=value;
    });
    assert.deepEqual(accountChildIdentity(row),{found:true,value});
  }
});
test('null containers and invalid list items retain GraphQL completion behavior', async () => {
  assert.equal((await execute('{users{Email}}',null)).errors,undefined);
  assert.ok((await execute('{users{Email}}',42)).errors?.length);
  const result=await execute('{users{Email}}',[null,42]);
  assert.equal(result.errors,undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)),{users:[null,{Email:null}]});
});
test('source failures propagate without inventing a response',async()=>{
  const response=await execute('{users{Email}}',[],()=>{throw new Error('source failed');});
  assert.equal(response.errors?.[0].message,'source failed');
  assert.deepEqual(response.errors?.[0].path,['users']);
});

test('mutation response dependency traversal preserves payload fragments and internal identity',async()=>{
  const mutationSchema=buildSchema('type Query{ok:Boolean} type Mutation{updateUsers:Payload} type Payload{users:[User]} type User{username:String Email:String}');
  let row: Record<string, unknown> | undefined;
  const response=await graphql({schema:mutationSchema,source:'mutation($show:Boolean=true){updateUsers{...PayloadFields @include(if:$show)}} fragment PayloadFields on Payload{users{... on User{Email}}}',contextValue:context,rootValue:{
    updateUsers:(args:Record<string,unknown>,ctx:GraphQLContext,info:GraphQLResolveInfo)=>resolveUpdatedUsersWithChildIdentity((_p,_a,_c,selected)=>{
      const payload=selected.fragments.PayloadFields.selectionSet.selections[0];
      assert.equal(payload.kind,Kind.FIELD);
      if(payload.kind!==Kind.FIELD)throw new Error('expected users field');
      const children=payload.selectionSet!.selections;
      const dependency=children[children.length-1];
      assert.equal(dependency.kind,Kind.FIELD);
      if(dependency.kind!==Kind.FIELD)throw new Error('expected identity field');
      row={[dependency.alias!.value]:'alice',Email:'private'};
      return {users:[row]};
    },null,args,ctx,info),
  }});
  assert.equal(response.errors,undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(response.data)),{updateUsers:{users:[{Email:'private'}]}});
  assert.ok(row);
  assert.deepEqual(accountChildIdentity(row),{found:true,value:'alice'});
});

test('canonical connection source paths remain independent of requested aliases',async()=>{
  assert.throws(()=>userChildIdentityAtPath([]),/path is required/);
  const connectionSchema=buildSchema('type Query{usersConnection:Connection} type Connection{edges:[Edge]} type Edge{node:User} type User{username:String Email:String}');
  const adapter=userChildIdentityAtPath(['edges','node'],'canonical');
  let row: Record<string,unknown> | undefined;
  const response=await graphql({schema:connectionSchema,source:'{usersConnection{links:edges{person:node{Email}}}}',contextValue:context,rootValue:{
    usersConnection:(args:Record<string,unknown>,ctx:GraphQLContext,info:GraphQLResolveInfo)=>adapter((_p,_a,_c,selected)=>{
      let alias='';
      for(const node of selected.fieldNodes)visit(node,{Field(field){if(field.name.value==='username')alias=field.alias!.value;}});
      assert.ok(alias);row={[alias]:'alice',Email:'private'};
      return {edges:[{node:row},null]};
    },null,args,ctx,info),
  }});
  assert.equal(response.errors,undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(response.data)),{usersConnection:{links:[{person:{Email:'private'}},null]}});
  assert.ok(row);assert.deepEqual(accountChildIdentity(row),{found:true,value:'alice'});
});
