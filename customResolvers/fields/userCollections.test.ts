import assert from "node:assert/strict";
import test from "node:test";
import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";
import { CollectionVisibility } from "../../ogm_types.js";
import userCollections from "./userCollections.js";
import type { CollectionReadRepository } from "../../services/persistence/collectionReadRepository.js";

const setup = () => {
  const calls: unknown[] = [];
  const rows = [{ id: "collection" }];
  const repository: CollectionReadRepository = {
    findProfileCollections: async (where, options) => { calls.push({ where, options }); return rows; },
    findPublicContaining: async () => [], findOwnedShareTarget: async () => [], findShareChannel: async () => [],
  };
  return { calls, rows, resolver: userCollections({ driver: {} as Driver, collectionReadRepository: repository }) };
};
const ctx = (username: string) => ({ user: { username } }) as GraphQLContext;

test("profile filters preserve incoming owner override and force public only for other viewers", async () => {
  for (const username of ["profile", "visitor"]) {
    const state = setup();
    const where = { CreatedBy: { username: "override" }, visibility: CollectionVisibility.Private,
      OR: [{ name_CONTAINS: "cats" }, { Discussions_SOME: { id: "discussion" } }] };
    const result = await state.resolver({ username: "profile" }, { where }, ctx(username), {} as never);
    assert.equal(result, state.rows);
    assert.deepEqual(state.calls, [{ where: { ...where, visibility: username === "profile" ? "PRIVATE" : "PUBLIC" }, options: { sort: [{ createdAt: "DESC" }] } }]);
    assert.equal(where.visibility, "PRIVATE");
  }
});

test("profile defaults retain in-place options mutation and explicit empty sorting", async () => {
  const state = setup();
  const options = { limit: 3 };
  await state.resolver({ username: "profile" }, { options }, ctx("profile"), {} as never);
  assert.deepEqual(options, { limit: 3, sort: [{ createdAt: "DESC" }] });
  const explicit = { sort: [] };
  await state.resolver({ username: "profile" }, { options: explicit }, ctx("profile"), {} as never);
  assert.deepEqual(explicit, { sort: [] });
  assert.deepEqual(state.calls[1], { where: { CreatedBy: { username: "profile" } }, options: explicit });
});

test("profile read errors propagate unchanged", async () => {
  const failure = new Error("selection failed");
  const resolver = userCollections({ driver: {} as Driver, collectionReadRepository: {
    findProfileCollections: async () => { throw failure; },
  } as unknown as CollectionReadRepository });
  await assert.rejects(resolver({ username: "profile" }, {}, ctx("profile"), {} as never), error => error === failure);
});
