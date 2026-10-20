import assert from "node:assert/strict";
import test from "node:test";
import type { Driver } from "neo4j-driver";
import { makeResult } from "../../tests/fixtures/neo4j.js";
import {
  createContributionTargetRepository,
  CONTRIBUTION_USER_EXISTS_QUERY,
  CONTRIBUTION_MODERATION_PROFILE_EXISTS_QUERY,
  CONTRIBUTION_CHANNEL_EXISTS_QUERY,
  type ContributionTargetRepository,
} from "./contributionTargetRepository.js";

const cases: Array<[keyof ContributionTargetRepository, string]> = [
  ["userExists", CONTRIBUTION_USER_EXISTS_QUERY],
  ["moderationProfileExists", CONTRIBUTION_MODERATION_PROFILE_EXISTS_QUERY],
  ["channelExists", CONTRIBUTION_CHANNEL_EXISTS_QUERY],
];

for (const [method, query] of cases) {
  test(`${method} preserves managed READ routing, database, bookmarks and exact names`, async () => {
    const events: string[] = [];
    const bookmarkManager = {};
    const name = " spaced ' target ";
    const driver = {
      executeQueryBookmarkManager: bookmarkManager,
      session(config: unknown) {
        assert.deepEqual(config, {
          database: "contribution-db",
          defaultAccessMode: "READ",
          bookmarkManager,
        });
        events.push("open");
        return {
          async executeRead(work: (tx: unknown) => unknown) {
            events.push("executeRead");
            return work({
              async run(actualQuery: string, parameters: unknown) {
                assert.equal(actualQuery, query);
                assert.deepEqual(parameters, { name });
                events.push("run");
                return makeResult([{ exists: true }]);
              },
            });
          },
          async close() { events.push("close"); },
        };
      },
    } as unknown as Driver;
    const repository = createContributionTargetRepository(driver, "contribution-db");
    assert.equal(await repository[method](name), true);
    assert.deepEqual(events, ["open", "executeRead", "run", "close"]);
  });

  test(`${method} reports missing targets and closes after failures`, async () => {
    let closeCount = 0;
    let fail = false;
    const error = new Error("database unavailable");
    const driver = {
      session() {
        return {
          async executeRead(work: (tx: unknown) => unknown) {
            return work({
              async run() {
                if (fail) throw error;
                return makeResult();
              },
            });
          },
          async close() { closeCount += 1; },
        };
      },
    } as unknown as Driver;
    const repository = createContributionTargetRepository(driver);
    assert.equal(await repository[method]("missing"), false);
    fail = true;
    await assert.rejects(repository[method]("missing"), error);
    assert.equal(closeCount, 2);
  });
}
