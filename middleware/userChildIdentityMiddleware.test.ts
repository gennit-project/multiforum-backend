import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { buildSchema, graphql, Kind, type GraphQLResolveInfo } from "graphql";
import { ownerProtectedUserFields, resolveUsersWithChildIdentity } from "./userChildIdentityMiddleware.js";
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
