import assert from "node:assert/strict";
import test from "node:test";
import type { Driver } from "neo4j-driver";
import { linkSeededChannelRoleOwners } from "./seedDataForCypressTests.js";

test("Cypress seed roles are linked to their scalar owning channels", async () => {
  const queries: string[] = [];
  let closed = false;
  const driver = {
    session: () => ({
      run: async (query: string) => {
        queries.push(query);
        return { records: [] };
      },
      close: async () => {
        closed = true;
      },
    }),
  } as unknown as Driver;

  await linkSeededChannelRoleOwners(driver);

  assert.equal(queries.length, 2);
  assert.match(queries[0], /OWNS_CHANNEL_ROLE/);
  assert.match(queries[1], /OWNS_MOD_CHANNEL_ROLE/);
  assert.equal(closed, true);
});
