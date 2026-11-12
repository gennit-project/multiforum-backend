import assert from "node:assert/strict";
import { test } from "node:test";
import neo4j from "neo4j-driver";

for (const scenario of [
  { serverIssues: 2, channelIssues: 1, valid: true },
  { serverIssues: 1, channelIssues: 1, valid: false },
  { serverIssues: 2, channelIssues: 0, valid: false },
]) {
  test(`admin moderation seed verifies scopes ${JSON.stringify(scenario)}`, async (t) => {
    const queries: string[] = [];
    let sessionClosed = false;
    let driverClosed = false;
    t.mock.method(neo4j, "driver", () => ({
      session: () => ({
        run: async (query: string) => {
          queries.push(query);
          return {
            records: [{
              get: (key: "serverIssues" | "channelIssues") => neo4j.int(scenario[key]),
            }],
          };
        },
        close: async () => { sessionClosed = true; },
      }),
      close: async () => { driverClosed = true; },
    }));

    const load = import(`./seedAdminModerationScenario.js?scopes=${scenario.serverIssues}-${scenario.channelIssues}`);
    if (scenario.valid) {
      await load;
    } else {
      await assert.rejects(load, /invalid issue scopes/);
    }
    const seed = queries[1];
    for (const name of ["userIssue", "modIssue"]) {
      const block = seed.match(new RegExp(`CREATE \\(${name}:Issue \\{([\\s\\S]*?)\\}\\)`));
      assert.ok(block, `missing ${name}`);
      assert.doesNotMatch(block[1], /channelUniqueName/);
    }
    assert.match(seed, /channelUniqueName: channel.uniqueName/);
    assert.match(queries[2], /issue.channelUniqueName IS NULL/);
    assert.ok(sessionClosed && driverClosed, "connections close on success and failure");
  });
}
