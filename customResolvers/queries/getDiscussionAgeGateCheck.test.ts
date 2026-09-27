import test from "node:test";
import assert from "node:assert/strict";
import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";
import type { ServerConfigModel } from "../../ogm_types.js";
import getDiscussionAgeGateCheck from "./getDiscussionAgeGateCheck.js";

// loadAgePolicy reads the ServerConfig named here; without it the gate is off.
process.env.SERVER_CONFIG_NAME = "Test Server";

type Scenario = {
  gateEnabled?: boolean;
  sensitive?: boolean | null;
  username?: string | null;
  birthday?: string | null;
};

const policyModel = (gateEnabled: boolean) =>
  ({
    find: async () => [
      { sensitiveContentAgeGateEnabled: gateEnabled, minimumSensitiveContentAge: 18 },
    ],
  }) as unknown as ServerConfigModel;

// Answers the discussion lookup and the birthday lookup by query shape.
const driverFor = ({ sensitive, birthday }: Scenario) =>
  ({
    session: () => ({
      run: async (query: string) => ({
        records: [
          {
            get: () => (query.includes("Discussion") ? sensitive ?? null : birthday ?? null),
          },
        ],
      }),
      close: async () => undefined,
    }),
  }) as unknown as Driver;

const contextFor = (username: string | null) =>
  ({
    user: username
      ? { username, email: `${username}@example.com`, email_verified: true, data: null }
      : undefined,
    req: { headers: {} },
  }) as unknown as GraphQLContext;

const check = (scenario: Scenario) =>
  getDiscussionAgeGateCheck({
    driver: driverFor(scenario),
    ServerConfig: policyModel(scenario.gateEnabled ?? true),
  })(undefined, { discussionId: "d" }, contextFor(scenario.username ?? null));

const NOT_REQUIRED = { requiresAgeCheck: false, status: "ALLOWED", minimumAge: null };

for (const [label, scenario, expected] of [
  ["the gate is off", { gateEnabled: false, sensitive: true }, NOT_REQUIRED],
  ["the discussion isn't marked", { sensitive: false }, NOT_REQUIRED],
  ["the discussion doesn't exist", { sensitive: null }, NOT_REQUIRED],
  [
    "the viewer is signed out",
    { sensitive: true, username: null },
    { requiresAgeCheck: true, status: "SIGN_IN_REQUIRED", minimumAge: 18 },
  ],
  [
    "the viewer has no birthday",
    { sensitive: true, username: "alice", birthday: null },
    { requiresAgeCheck: true, status: "BIRTHDAY_REQUIRED", minimumAge: 18 },
  ],
  [
    "the viewer is under the minimum age",
    { sensitive: true, username: "alice", birthday: `${new Date().getFullYear() - 10}-01-01` },
    { requiresAgeCheck: true, status: "UNDER_MINIMUM_AGE", minimumAge: 18 },
  ],
  [
    "the viewer is old enough",
    { sensitive: true, username: "alice", birthday: "1990-01-01" },
    NOT_REQUIRED,
  ],
] as const) {
  test(`reports ${expected.status} when ${label}`, async () => {
    assert.deepEqual(await check(scenario), expected);
  });
}
