import { rememberAccountChildIdentity } from "../../services/accountChildIdentity.js";
import type { ProfileCollectionProjection } from "../contracts/accountProjections.js";
import { CollectionType } from "../../src/generated/graphql.js";
import assert from "node:assert/strict";
import test from "node:test";
import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";
import { CollectionVisibility } from "../../ogm_types.js";
import userCollections from "./userCollections.js";
import type { CollectionReadRepository } from "../../services/persistence/collectionReadRepository.js";

const setup = () => {
  const calls: unknown[] = [];
  const rows: ProfileCollectionProjection[] = [{ id: "collection", name: "Collection", description: null, visibility: CollectionVisibility.Public, collectionType: CollectionType.Downloads, itemCount: 0, itemOrder: [], createdAt: "2026-01-01", updatedAt: null, Channels: [], Discussions: [], Comments: [], Downloads: [], Images: [] }];
  const repository: CollectionReadRepository = {
    findProfileCollections: async (where, options, viewerUsername) => { calls.push({ where, options, viewerUsername }); return rows; },
    findPublicContaining: async () => [], findOwnedShareTarget: async () => [], findShareChannel: async () => [],
  };
  return { calls, rows, resolver: userCollections({ driver: {} as Driver, collectionReadRepository: repository }) };
};
const ctx = (username: string) => ({ user: { username } }) as GraphQLContext;

test("profile filters intersect caller constraints with immutable owner and visibility scope", async () => {
  for (const username of ["profile", "visitor"]) {
    const state = setup();
    const where = { CreatedBy: { username: { eq: "override" } }, visibility: { eq: CollectionVisibility.Private },
      OR: [{ name: { contains: "cats" } }, { Discussions: { some: { id: { eq: "discussion" } } } }] };
    const before = structuredClone(where);
    const result = await state.resolver({ username: "profile" }, { where }, ctx(username), {} as never);
    assert.equal(result, state.rows);
    assert.deepEqual(state.calls, [{ where: { AND: [{ CreatedBy: { username: { eq: "profile" } },
      ...(username === "profile" ? {} : { visibility: { eq: "PUBLIC" } }) }, where] }, options: { sort: [{ createdAt: "DESC" }] }, viewerUsername: username }]);
    assert.deepEqual(where, before);
  }
});

test("profile accepts generated pagination arguments without mutating them", async () => {
  const state = setup();
  const args = { limit: 3, offset: 1 };
  await state.resolver({ username: "profile" }, args, ctx("profile"), {} as never);
  assert.deepEqual(args, { limit: 3, offset: 1 });
  const explicit = { sort: [], limit: 0 };
  await state.resolver({ username: "profile" }, explicit, ctx("profile"), {} as never);
  assert.deepEqual(explicit, { sort: [], limit: 0 });
  assert.deepEqual(state.calls, [
    { where: { CreatedBy: { username: { eq: "profile" } } }, options: { sort: [{ createdAt: "DESC" }], limit: 3, offset: 1 }, viewerUsername: "profile" },
    { where: { CreatedBy: { username: { eq: "profile" } } }, options: explicit, viewerUsername: "profile" },
  ]);
});

test("profile read errors propagate unchanged", async () => {
  const failure = new Error("selection failed");
  const resolver = userCollections({ driver: {} as Driver, collectionReadRepository: {
    findProfileCollections: async () => { throw failure; },
  } as unknown as CollectionReadRepository });
  await assert.rejects(resolver({ username: "profile" }, {}, ctx("profile"), {} as never), error => error === failure);
});

test("profile reads require a valid source identity before constructing database filters",async()=>{
  for(const username of [undefined,null,7,{},""]) {
    const state=setup();
    await assert.rejects(state.resolver({username},{},ctx("profile"),{} as never),/username/i);
    assert.deepEqual(state.calls,[]);
  }
});
test("source-selected account identity takes precedence over response keys",async()=>{
  const state=setup();const parent={username:"other"};
  rememberAccountChildIdentity(parent,"profile");
  await state.resolver(parent,{},ctx("profile"),{} as never);
  assert.deepEqual(state.calls,[{where:{CreatedBy:{username:{eq:"profile"}}},options:{sort:[{createdAt:"DESC"}]},viewerUsername:"profile"}]);
  for(const value of [undefined,null,7,{},""]) {
    rememberAccountChildIdentity(parent,value);
    await assert.rejects(state.resolver(parent,{},ctx("profile"),{} as never),/username/i);
  }
  assert.equal(state.calls.length,1);
});
