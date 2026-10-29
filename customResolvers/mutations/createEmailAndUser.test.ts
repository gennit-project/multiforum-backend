import test from "node:test";
import assert from "node:assert/strict";
import { isDate } from "neo4j-driver";
import { createUsersWithEmails } from "./createEmailAndUser.js";
import type {
  AccountRegistrationRepository,
  CompleteRegistration,
} from "../../services/persistence/accountRegistrationRepository.js";
import type { UserCreateInput } from "../../ogm_types.js";

const stubRepository = () =>
  ({
    completeRegistration: async ({ createInput }: CompleteRegistration) => {
      createInput();
      return { username: "new_user" };
    },
  }) as AccountRegistrationRepository;

for (const [username, message] of [
  ["bad name", /letters, numbers, and underscores/],
  ["a".repeat(51), /cannot exceed/],
  ["", /required/],
  ["bot-evil", /reserved/],
] as const) {
  test(`rejects invalid new username ${username}`, async () => {
    await assert.rejects(
      createUsersWithEmails(stubRepository(), "a@b.com", username),
      message,
    );
  });
}

test("rejects missing email", async () => {
  await assert.rejects(
    createUsersWithEmails(stubRepository(), "", "valid"),
    /required/,
  );
});

test("enforces account minimum age before creating a new profile", async () => {
  await assert.rejects(
    createUsersWithEmails(
      stubRepository(),
      "a@b.com",
      "valid_name",
      "2015-01-01",
      {
        accountAgeGateEnabled: true,
        minimumAccountAge: 13,
        sensitiveContentAgeGateEnabled: true,
        minimumSensitiveContentAge: 18,
      },
    ),
    /MINIMUM_AGE_NOT_MET/,
  );
});

test("passes a date-only birthday to atomic registration", async () => {
  let created: UserCreateInput | undefined;
  const repository = {
    ...stubRepository(),
    completeRegistration: async ({ createInput }: CompleteRegistration) => {
      created = createInput();
      return { username: "adult_user" };
    },
  };
  await createUsersWithEmails(
    repository,
    "adult@example.com",
    "adult_user",
    "2000-01-01",
  );
  assert.equal(isDate(created?.dateOfBirth), true);
  assert.equal(String(created?.dateOfBirth), "2000-01-01");
});

test("restores the verified email's existing account without validating or overwriting signup inputs", async () => {
  const existing = { username: "original_user", Email: { address: "a@b.com" } };
  const repository = {
    ...stubRepository(),
    completeRegistration: async () => existing,
  };
  assert.equal(
    await createUsersWithEmails(repository, "a@b.com", "", "invalid"),
    existing,
  );
});

test("propagates registration failures instead of claiming signup succeeded", async () => {
  const failure = new Error("database failed");
  const repository = {
    ...stubRepository(),
    completeRegistration: async () => {
      throw failure;
    },
  };
  await assert.rejects(
    createUsersWithEmails(repository, "a@b.com", "valid_name"),
    (error) => error === failure,
  );
});

test("resolver uses the verified email and rejects mismatches or unverified sessions before registration", async () => {
  const { default: createResolver } = await import("./createEmailAndUser.js");
  const addresses: string[] = [];
  const repository = {
    ...stubRepository(),
    completeRegistration: async ({ emailAddress }: CompleteRegistration) => {
      addresses.push(emailAddress);
      return { username: "existing_user" };
    },
  };
  const resolver = createResolver({
    accountRegistrationRepository: repository,
    agePolicyRepository: { findAgePolicyConfigs: async () => [] },
  });
  const context = {
    user: {
      username: "verified_identity",
      email: "Verified@Example.test",
      email_verified: true,
    },
  } as never;
  assert.deepEqual(
    await resolver(
      null,
      { username: "new_user", emailAddress: "verified@example.TEST" },
      context,
      {} as never,
    ),
    { username: "existing_user" },
  );
  await assert.rejects(
    resolver(
      null,
      { username: "new_user", emailAddress: "different@example.test" },
      context,
      {} as never,
    ),
    /Account email must match/,
  );
  await assert.rejects(
    resolver(
      null,
      { username: "new_user", emailAddress: "verified@example.test" },
      {
        user: {
          username: "verified_identity",
          email: "Verified@Example.test",
          email_verified: false,
        },
      } as never,
      {} as never,
    ),
    /A verified login is required/,
  );
  assert.deepEqual(addresses, ["Verified@Example.test"]);
});

test("Cypress identities, admin role, and new email spelling remain unchanged", async () => {
  const previous = {
    name: process.env.SERVER_CONFIG_NAME,
    email: process.env.CYPRESS_ADMIN_TEST_EMAIL,
  };
  process.env.SERVER_CONFIG_NAME = "Cypress Test Server";
  process.env.CYPRESS_ADMIN_TEST_EMAIL = "admin@example.test";
  let created: UserCreateInput | undefined;
  const repository = {
    ...stubRepository(),
    completeRegistration: async ({ createInput }: CompleteRegistration) => {
      created = createInput();
      return { username: "alice" };
    },
  };
  try {
    await createUsersWithEmails(repository, "admin@example.test", "alice");
    assert.equal(
      created?.ModerationProfile?.create?.node.displayName,
      "testModProfile2",
    );
    assert.deepEqual(created?.ServerRoles, {
      connect: [{ where: { node: { name: { eq: "Admin Role" } } } }],
    });
    assert.equal(created?.Email?.create?.node.address, "admin@example.test");
    await createUsersWithEmails(repository, "other@example.test", "cluse");
    assert.equal(
      created?.ModerationProfile?.create?.node.displayName,
      "testModProfile1",
    );
  } finally {
    if (previous.name === undefined) delete process.env.SERVER_CONFIG_NAME;
    else process.env.SERVER_CONFIG_NAME = previous.name;
    if (previous.email === undefined)
      delete process.env.CYPRESS_ADMIN_TEST_EMAIL;
    else process.env.CYPRESS_ADMIN_TEST_EMAIL = previous.email;
  }
});
