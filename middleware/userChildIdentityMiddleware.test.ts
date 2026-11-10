import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { buildSchema, graphql, Kind, visit, type GraphQLResolveInfo } from "graphql";
import { ownerProtectedUserFields, resolveUsersWithChildIdentity, resolveUpdatedUsersWithChildIdentity, userChildIdentityAtPath, userChildIdentityAtPaths } from "./userChildIdentityMiddleware.js";
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
  assert.throws(()=>userChildIdentityAtPath(["node"],[]),/key convention/);
  const connectionSchema=buildSchema('type Query{usersConnection:Connection} type Connection{edges:[Edge]} type Edge{node:User} type User{username:String Email:String}');
  const adapter=userChildIdentityAtPath(['edges','node'],['canonical','canonical']);
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

test('multiple source dependencies execute once and leave public-only paths untouched',async()=>{
 assert.throws(()=>userChildIdentityAtPaths([]),/source path is required/);
 const nestedSchema=buildSchema('type Query{channels:[Channel]} type Channel{Admins:[User] Bots:[User]} type User{username:String Email:String}');
 const adapter=userChildIdentityAtPaths([{path:['Admins']},{path:['Bots']}]);
 let calls=0;let admin:Record<string,unknown>|undefined;
 const bot={username:'bob'};
 const response=await graphql({schema:nestedSchema,source:'{channels{Admins{Email} Bots{username}}}',contextValue:context,rootValue:{
  channels:(args:Record<string,unknown>,ctx:GraphQLContext,info:GraphQLResolveInfo)=>adapter((_p,_a,_c,selected)=>{
   calls++;const aliases:string[]=[];
   for(const node of selected.fieldNodes)visit(node,{Field(field){if(field.name.value==='username'&&field.alias)aliases.push(field.alias.value);}});
   assert.equal(aliases.length,1);admin={[aliases[0]]:'alice',Email:'private'};
   return [{Admins:[admin],Bots:[bot]}];
  },null,args,ctx,info),
 }});
 assert.equal(response.errors,undefined);assert.equal(calls,1);
 assert.ok(admin);assert.deepEqual(accountChildIdentity(admin),{found:true,value:'alice'});
 assert.deepEqual(accountChildIdentity(bot),{found:false});
 assert.deepEqual(JSON.parse(JSON.stringify(response.data)),{channels:[{Admins:[{Email:'private'}],Bots:[{username:'bob'}]}]});
});

test('author union branch markers ignore caller aliases and retain unknown identity values', async () => {
  const { authorSourceType } = await import('../services/authorSourceType.js');
  const { isUnionType } = await import('graphql');
  const unionSchema = buildSchema('type Query{items:[Item]} type Item{author:Actor} union Actor=User|ModerationProfile type User{username:String bio:String Email:String} type ModerationProfile{displayName:String}');
  const union = unionSchema.getType('Actor');
  assert.ok(isUnionType(union));
  union.resolveType = row => { const type = authorSourceType(row); return type.found ? type.value ?? undefined : undefined; };
  const adapter = userChildIdentityAtPaths([{path:['author'],userUnion:true}]);
  for (const branch of ['User','ModerationProfile','missing','ambiguous']) {
    const row: Record<string, unknown> = {username:'forged',displayName:'forged'};
    const response = await graphql({schema:unionSchema,source:'{items{author{__typename ... on User{_accountIdentity:bio _moderatorIdentity:bio Email}}}}',contextValue:context,rootValue:{
      items:(args:Record<string,unknown>,ctx:GraphQLContext,info:GraphQLResolveInfo)=>adapter((_p,_a,_c,selected)=>{
        const author=selected.fieldNodes[0].selectionSet!.selections[0];
        assert.equal(author.kind,Kind.FIELD);
        if(author.kind!==Kind.FIELD)throw new Error('expected author');
        for(const fragment of author.selectionSet!.selections.slice(-2)) {
          assert.equal(fragment.kind,Kind.INLINE_FRAGMENT);
          if(fragment.kind!==Kind.INLINE_FRAGMENT)throw new Error('expected branch');
          const dependency=fragment.selectionSet.selections[0];
          assert.equal(dependency.kind,Kind.FIELD);
          if(dependency.kind!==Kind.FIELD)throw new Error('expected dependency');
          assert.ok(!['_accountIdentity','_moderatorIdentity'].includes(dependency.alias!.value));
          if(branch===fragment.typeCondition!.name.value||branch==='ambiguous')row[dependency.alias!.value]=null;
        }
        return [{author:row}];
      },null,args,ctx,info),
    }});
    const expected=branch==='User'||branch==='ModerationProfile'?branch:null;
    assert.deepEqual(authorSourceType(row),{found:true,value:expected});
    assert.deepEqual(accountChildIdentity(row),branch==='User'?{found:true,value:null}:{found:false});
    if(expected)assert.equal(response.errors,undefined,JSON.stringify(response.errors));
    else assert.deepEqual(response.errors?.map(error=>error.path),[['items',0,'author']]);
  }
});

test('skipped author unions do not inject branch markers or inspect a source', async () => {
  const { authorSourceType } = await import('../services/authorSourceType.js');
  const unionSchema=buildSchema('type Query{items:[Item]} type Item{id:ID author:Actor} union Actor=User|ModerationProfile type User{username:String} type ModerationProfile{displayName:String}');
  const row={username:'alice'};
  const adapter=userChildIdentityAtPaths([{path:['author'],userUnion:true}]);
  const response=await graphql({schema:unionSchema,source:'query($hide:Boolean=true){items{id author @skip(if:$hide){__typename}}}',contextValue:context,rootValue:{
    items:(args:Record<string,unknown>,ctx:GraphQLContext,info:GraphQLResolveInfo)=>adapter((_p,_a,_c,selected)=>{
      assert.equal(selected,info);return [{id:'one',author:row}];
    },null,args,ctx,info),
  }});
  assert.equal(response.errors,undefined);
  assert.deepEqual(authorSourceType(row),{found:false});
});

test('generated internal author metadata is scoped, validated and never inferred from selected names', async () => {
  const {generatedAuthorTypesAtPaths} = await import('./userChildIdentityMiddleware.js');
  const {authorSourceType} = await import('../services/authorSourceType.js');
  const internalSchema=buildSchema('type Query{items:[Item]} type Item{author:User} type User{username:String}');
  const adapter=generatedAuthorTypesAtPaths([{path:['author']}]);
  assert.throws(()=>generatedAuthorTypesAtPaths([{path:[]}]),/Invalid/);
  assert.throws(()=>generatedAuthorTypesAtPaths([{path:['author'],sourceKeys:[]}]),/Invalid/);
  for(const marker of ['User','ModerationProfile','forged',null,undefined]) {
    const row:Record<string,unknown>={username:'forged'};
    if(marker!==undefined)row.__resolveType=marker;
    const response=await graphql({schema:internalSchema,source:'{items{alias:author{username}}}',contextValue:context,rootValue:{
      items:(args:Record<string,unknown>,ctx:GraphQLContext,info:GraphQLResolveInfo)=>adapter((_p,_a,_c,selected)=>{
        assert.equal(selected,info);return [{alias:row},null,{alias:null}];
      },null,args,ctx,info),
    }});
    assert.equal(response.errors,undefined);
    assert.deepEqual(authorSourceType(row),marker===undefined?{found:false}:{found:true,value:marker==='User'||marker==='ModerationProfile'?marker:null});
  }
});
test('selected reply discovery follows only requested Comment edges and directive branches',async()=>{
 const {selectedCommentAuthorPaths}=await import('./userChildIdentityMiddleware.js');
 const {print}=await import('graphql');
 const probe=buildSchema('type Query{comments:[Comment]} type Comment{CommentAuthor:User ParentComment:Comment ChildComments:[Comment] unrelated:Other} type Other{CommentAuthor:User} type User{username:String}');
 for(const show of [true,false]){
  let paths:unknown;
  const response=await graphql({schema:probe,source:'query($show:Boolean!=true){comments{up:ParentComment{...Deep} unrelated{CommentAuthor{username}}}} fragment Deep on Comment{children:ChildComments @include(if:$show){ParentComment{CommentAuthor{username}}}}',variableValues:{show},rootValue:{comments:(_args:unknown,_context:unknown,info:GraphQLResolveInfo)=>{
   const before=print(info.operation);
   paths=selectedCommentAuthorPaths(info).map(path=>path.path);
   assert.equal(print(info.operation),before);
   return [];
  }}});
  assert.equal(response.errors,undefined,JSON.stringify(response.errors));
  assert.deepEqual(paths,show?[['ParentComment','ChildComments','ParentComment','CommentAuthor']]:[]);
 }
});
