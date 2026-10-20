import assert from "node:assert/strict";
import test from "node:test";
import neo4j, { type Driver } from "neo4j-driver";
import {
  FIND_REQUEST_USER_BY_EMAIL_QUERY,
  FIND_REQUEST_USER_BY_USERNAME_QUERY,
  USER_EXISTS_QUERY,
  createRequestIdentityRepository,
  resolveRequestIdentityRepository,
} from "./requestIdentityRepository.js";

const record = (values: Record<string, unknown>) => ({
  get(key: string) {
    return values[key];
  },
});

test("identity reads are parameterized, leader-routed, and close sessions", async () => {
  const sessionConfigs: unknown[] = [];
  const calls: Array<{ query: string; parameters: unknown }> = [];
  let closeCalls = 0;
  const driver = {
    session(config: unknown) {
      sessionConfigs.push(config);
      return {
        async run(query: string, parameters: unknown) {
          calls.push({ query, parameters });
          if (query === USER_EXISTS_QUERY) {
            return { records: [record({ exists: true })] };
          }
          return {
            records: [
              record({
                username: "alice",
                dateOfBirth: "1991-04-05",
                modProfileName: "Mod Alice",
              }),
            ],
          };
        },
        async close() {
          closeCalls += 1;
        },
      };
    },
  } as unknown as Driver;
  const repository = createRequestIdentityRepository(driver, "identity-db");

  assert.deepEqual(await repository.findByUsername("alice"), {
    username: "alice",
    dateOfBirth: "1991-04-05",
    modProfileName: "Mod Alice",
  });
  assert.deepEqual(await repository.findByEmail("alice@example.test"), {
    username: "alice",
    dateOfBirth: "1991-04-05",
    modProfileName: "Mod Alice",
  });
  assert.equal(await repository.userExists("alice"), true);
  assert.deepEqual(
    sessionConfigs,
    Array(3).fill({
      database: "identity-db",
      defaultAccessMode: neo4j.session.WRITE,
    })
  );
  assert.deepEqual(calls, [
    {
      query: FIND_REQUEST_USER_BY_USERNAME_QUERY,
      parameters: { username: "alice" },
    },
    {
      query: FIND_REQUEST_USER_BY_EMAIL_QUERY,
      parameters: { email: "alice@example.test" },
    },
    { query: USER_EXISTS_QUERY, parameters: { username: "alice" } },
  ]);
  assert.equal(closeCalls, 3);
});

test("identity reads normalize values and return explicit missing states", async () => {
  let call = 0;
  const driver = {
    session() {
      return {
        async run() {
          call += 1;
          if (call === 1) {
            return {
              records: [
                record({
                  username: "alice",
                  dateOfBirth: { toString: () => "1991-04-05" },
                  modProfileName: 42,
                }),
              ],
            };
          }
          return { records: [] };
        },
        async close() {},
      };
    },
  } as unknown as Driver;
  const repository = createRequestIdentityRepository(driver);

  assert.deepEqual(await repository.findByUsername("alice"), {
    username: "alice",
    dateOfBirth: "1991-04-05",
    modProfileName: null,
  });
  assert.equal(await repository.findByEmail("missing@example.test"), null);
  assert.equal(await repository.userExists("missing"), false);
});

test("identity reads reject invalid usernames returned by the database", async () => {
  const driver = {
    session() {
      return {
        async run() {
          return {
            records: [
              record({
                username: null,
                dateOfBirth: null,
                modProfileName: null,
              }),
            ],
          };
        },
        async close() {},
      };
    },
  } as unknown as Driver;

  assert.equal(
    await createRequestIdentityRepository(driver).findByUsername("alice"),
    null
  );
});

test("identity reads close their session when a query fails", async () => {
  let closeCalls = 0;
  const driver = {
    session() {
      return {
        async run() {
          throw new Error("read failed");
        },
        async close() {
          closeCalls += 1;
        },
      };
    },
  } as unknown as Driver;
  const repository = createRequestIdentityRepository(driver);

  await assert.rejects(repository.findByUsername("alice"), /read failed/);
  assert.equal(closeCalls, 1);
});

test("repository resolution honors an injected implementation", () => {
  const injected = {
    findByUsername: async () => null,
    findByEmail: async () => null,
    userExists: async () => false,
  };
  assert.equal(
    resolveRequestIdentityRepository({
      driver: {} as Driver,
      requestIdentityRepository: injected,
    }),
    injected
  );
});
