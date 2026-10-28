import assert from "node:assert/strict";
import test from "node:test";
import neo4j, { type Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";
import type { ContributionTargetRepository } from "../../services/persistence/contributionTargetRepository.js";
import { makeResult } from "../../tests/fixtures/neo4j.js";
import getUserContributions from "./getUserContributions.js";
import getModContributions from "./getModContributions.js";
import getChannelContributions from "./getChannelContributions.js";
import getUserWikiEditsCount from "./getUserWikiEditsCount.js";

type Input = { driver: Driver; contributionTargetRepository: ContributionTargetRepository };
const context = { mayAccessSensitiveContent: true } as GraphQLContext;
const cases: Array<{
  name: string;
  method: keyof ContributionTargetRepository;
  missing: string;
  failurePrefix: string;
  run: (input: Input) => Promise<unknown>;
}> = [
  {
    name: "user", method: "userExists",
    missing: "User target not found.", failurePrefix: "Failed to fetch contributions for user target: ",
    run: (input) => getUserContributions(input)(null, { username: "target", year: 2025 }, context),
  },
  {
    name: "moderator", method: "moderationProfileExists",
    missing: "Moderation profile target not found.", failurePrefix: "Failed to fetch contributions for mod target: ",
    run: (input) => getModContributions(input)(null, { displayName: "target", year: 2025 }, context),
  },
  {
    name: "channel", method: "channelExists",
    missing: "Channel target not found.", failurePrefix: "Failed to fetch contributions for channel target: ",
    run: (input) => getChannelContributions(input)(null, { channelUniqueName: "target", year: 2025 }, context),
  },
  {
    name: "wiki", method: "userExists",
    missing: "User target not found.", failurePrefix: "Failed to fetch wiki edits count for user target: ",
    run: (input) => getUserWikiEditsCount(input)(null, { username: "target" }),
  },
];

for (const entry of cases) {
  for (const mode of ["present", "missing", "error"] as const) {
    test(`${entry.name} preserves existence/aggregation ordering and ${mode} result`, async () => {
      const events: string[] = [];
      const driver = {
        session(config: unknown) {
          // Leader routing (read-your-own-writes): the resolver opens the session
          // with no config, not a READ-mode session (see docs/architecture.md).
          assert.deepEqual(config, undefined);
          events.push("open aggregation");
          return {
            async run(_query: string, parameters: Record<string, unknown>) {
              events.push("aggregate");
              if (entry.name !== "wiki") {
                assert.equal(parameters.startDate, "2025-01-01");
                assert.equal(parameters.endDate, "2025-12-31");
                assert.equal(parameters.mayAccessSensitiveContent, true);
              }
              return makeResult();
            },
            async close() { events.push("close aggregation"); },
          };
        },
      } as unknown as Driver;
      const unexpected = async () => { throw new Error("wrong target check"); };
      const contributionTargetRepository: ContributionTargetRepository = {
        userExists: unexpected,
        moderationProfileExists: unexpected,
        channelExists: unexpected,
        [entry.method]: async (name: string) => {
          assert.equal(name, "target");
          events.push("exists");
          if (mode === "error") throw new Error("read failed");
          return mode === "present";
        },
      };
      const result = entry.run({ driver, contributionTargetRepository });
      if (mode === "present") {
        assert.deepEqual(await result, entry.name === "wiki" ? 0 : []);
        assert.deepEqual(events, ["open aggregation", "exists", "aggregate", "close aggregation"]);
      } else {
        await assert.rejects(result, {
          message: entry.failurePrefix + (mode === "missing" ? entry.missing : "read failed"),
        });
        assert.deepEqual(events, ["open aggregation", "exists", "close aggregation"]);
      }
    });
  }
}

for (const kind of ["user", "moderator"] as const) {
  test(`${kind} keeps integer conversion and drops null dates`, async () => {
    const activities = [{ id: "activity" }];
    const driver = {
      session: () => ({
        run: async () => makeResult([
          { date: null, count: neo4j.int(8), activities: [] },
          { date: "2025-01-02", count: neo4j.int(3), activities },
          { date: "2025-01-03", count: 2, activities: [] },
        ]),
        close: async () => {},
      }),
    } as unknown as Driver;
    const contributionTargetRepository: ContributionTargetRepository = {
      userExists: async () => true,
      moderationProfileExists: async () => true,
      channelExists: async () => false,
    };
    const result = kind === "user"
      ? await getUserContributions({ driver, contributionTargetRepository })(null, { username: "alice" }, context)
      : await getModContributions({ driver, contributionTargetRepository })(null, { displayName: "Mod" }, context);
    assert.deepEqual(result, [
      { date: "2025-01-02", count: 3, activities },
      { date: "2025-01-03", count: 2, activities: [] },
    ]);
  });
}
