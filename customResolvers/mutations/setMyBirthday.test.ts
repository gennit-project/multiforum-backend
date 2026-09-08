import test from "node:test";
import assert from "node:assert/strict";
import setMyBirthday from "./setMyBirthday.js";

const context = {
  user: { username: "owner", email: "owner@example.com", email_verified: true, data: null },
} as any;
const ServerConfig = { find: async () => [] } as any;

function driverReturning(storedBirthday: string) {
  let params: Record<string, unknown> | undefined;
  let closed = false;
  return {
    driver: {
      session: () => ({
        run: async (_query: string, queryParams: Record<string, unknown>) => {
          params = queryParams;
          return { records: [{ get: () => storedBirthday }] };
        },
        close: async () => { closed = true; },
      }),
    } as any,
    getParams: () => params,
    isClosed: () => closed,
  };
}

test("sets birthday for the authenticated caller", async () => {
  const stub = driverReturning("2000-01-01");
  const resolver = setMyBirthday({ driver: stub.driver, ServerConfig });
  const result = await resolver(undefined, { birthday: "2000-01-01" }, context);

  assert.deepEqual(stub.getParams(), { username: "owner", birthday: "2000-01-01" });
  assert.equal(result.birthday, "2000-01-01");
  assert.equal(stub.isClosed(), true);
});

test("does not allow an existing birthday to be changed", async () => {
  const stub = driverReturning("1999-01-01");
  const resolver = setMyBirthday({ driver: stub.driver, ServerConfig });

  await assert.rejects(
    resolver(undefined, { birthday: "2000-01-01" }, context),
    /BIRTHDAY_ALREADY_SET/
  );
  assert.equal(stub.isClosed(), true);
});

test("rejects invalid birthdays before opening a database session", async () => {
  const resolver = setMyBirthday({
    driver: { session: () => { throw new Error("should not query"); } } as any,
    ServerConfig,
  });
  await assert.rejects(
    resolver(undefined, { birthday: "not-a-date" }, context),
    /INVALID_BIRTHDAY/
  );
});
