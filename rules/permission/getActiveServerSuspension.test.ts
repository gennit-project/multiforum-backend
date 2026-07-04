import assert from "node:assert/strict";
import test from "node:test";
import type { GraphQLContext } from "../../types/context.js";
import { getActiveServerSuspension } from "./getActiveServerSuspension.js";

const futureDate = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();
const pastDate = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

const buildDriver = (responses: {
  userSuspensions?: any[];
  modSuspensions?: any[];
}) => ({
  session: () => ({
    run: async (query: string) => {
      if (query.includes("MATCH (serverConfig)-[:SUSPENDED_AS_USER]->")) {
        return {
          records: (responses.userSuspensions ?? []).map((suspension) => ({
            get: () => suspension,
          })),
        };
      }

      if (query.includes("MATCH (serverConfig)-[:SUSPENDED_AS_MOD]->")) {
        return {
          records: (responses.modSuspensions ?? []).map((suspension) => ({
            get: () => suspension,
          })),
        };
      }

      throw new Error(`Unexpected query: ${query}`);
    },
    close: async () => {},
  }),
});

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

test("returns active server user suspension metadata", async () => {
  const result = await getActiveServerSuspension({
    context: {
      driver: buildDriver({
        userSuspensions: [
          {
            id: "server-user-1",
            username: "alice",
            serverName: "test-server",
            suspendedUntil: futureDate(),
            suspendedIndefinitely: false,
            RelatedIssue: { id: "issue-1", issueNumber: 12 },
          },
        ],
      }),
    } as unknown as GraphQLContext,
    username: "alice",
  });

  assert.equal(result.activeSuspension?.id, "server-user-1");
  assert.equal(result.isSuspended, true);
  assert.equal(result.relatedIssueNumber, 12);
  assert.equal(result.suspendedEntity, "user");
});

test("returns expired server mod suspensions for cleanup", async () => {
  const result = await getActiveServerSuspension({
    context: {
      driver: buildDriver({
        modSuspensions: [
          {
            id: "server-mod-1",
            modProfileName: "Mod Jane",
            serverName: "test-server",
            suspendedUntil: pastDate(),
            suspendedIndefinitely: false,
          },
        ],
      }),
    } as unknown as GraphQLContext,
    modProfileName: "Mod Jane",
  });

  assert.equal(result.isSuspended, false);
  assert.equal(result.expiredModSuspensions.length, 1);
  assert.equal(result.expiredModSuspensions[0].id, "server-mod-1");
});

test("memoizes concurrent identical lookups within one request", async () => {
  const deferred = createDeferred<any>();
  let userQueryCalls = 0;

  const context = {
    driver: {
      session: () => ({
        run: async (query: string) => {
          if (!query.includes("MATCH (serverConfig)-[:SUSPENDED_AS_USER]->")) {
            throw new Error(`Unexpected query: ${query}`);
          }
          userQueryCalls += 1;
          const suspension = await deferred.promise;
          return {
            records: [{ get: () => suspension }],
          };
        },
        close: async () => {},
      }),
    },
  } as unknown as GraphQLContext;

  const first = getActiveServerSuspension({ context, username: "alice" });
  const second = getActiveServerSuspension({ context, username: "alice" });

  assert.equal(userQueryCalls, 1);

  deferred.resolve({
    id: "server-user-2",
    username: "alice",
    serverName: "test-server",
    suspendedUntil: futureDate(),
    suspendedIndefinitely: false,
  });

  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.activeSuspension?.id, "server-user-2");
  assert.equal(secondResult.activeSuspension?.id, "server-user-2");
});

test("does not alias distinct actor tuples in the request cache", async () => {
  let userQueryCalls = 0;
  let modQueryCalls = 0;
  const context = {
    driver: {
      session: () => ({
        run: async (query: string, params: { username?: string; modProfileName?: string }) => {
          if (query.includes("MATCH (serverConfig)-[:SUSPENDED_AS_USER]->")) {
            userQueryCalls += 1;
            return {
              records: params.username === "alice"
                ? [{ get: () => ({
                    id: "user-suspension",
                    username: "alice",
                    serverName: "test-server",
                    suspendedUntil: futureDate(),
                    suspendedIndefinitely: false,
                  }) }]
                : params.username === "alice|mod"
                  ? [{ get: () => ({
                      id: "split-user-suspension",
                      username: "alice|mod",
                      serverName: "test-server",
                      suspendedUntil: futureDate(),
                      suspendedIndefinitely: false,
                    }) }]
                : [],
            };
          }

          if (query.includes("MATCH (serverConfig)-[:SUSPENDED_AS_MOD]->")) {
            modQueryCalls += 1;
            return {
              records: params.modProfileName === "mod|profile"
                ? [{ get: () => ({
                    id: "mod-suspension",
                    modProfileName: "mod|profile",
                    serverName: "test-server",
                    suspendedUntil: futureDate(),
                    suspendedIndefinitely: false,
                  }) }]
                : params.modProfileName === "profile"
                  ? [{ get: () => ({
                      id: "split-mod-suspension",
                      modProfileName: "profile",
                      serverName: "test-server",
                      suspendedUntil: futureDate(),
                      suspendedIndefinitely: false,
                    }) }]
                : [],
            };
          }

          throw new Error(`Unexpected query: ${query}`);
        },
        close: async () => {},
      }),
    },
  } as unknown as GraphQLContext;

  const userResult = await getActiveServerSuspension({
    context,
    username: "alice",
    modProfileName: "mod|profile",
  });
  const modResult = await getActiveServerSuspension({
    context,
    username: "alice|mod",
    modProfileName: "profile",
  });

  assert.equal(userResult.activeSuspension?.id, "user-suspension");
  assert.equal(modResult.activeSuspension?.id, "split-user-suspension");
  assert.equal(userQueryCalls, 2);
  assert.equal(modQueryCalls, 2);
});
