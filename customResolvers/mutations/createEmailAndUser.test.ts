import test from "node:test";
import assert from "node:assert/strict";
import { createUsersWithEmails } from "./createEmailAndUser.js";

// Validation runs before any DB access, so these stubs are never reached.
const stubModel = () =>
  ({
    find: async () => [],
    create: async () => ({ users: [{ username: "x" }] }),
  }) as any;

test("rejects a username with invalid characters", async () => {
  await assert.rejects(
    createUsersWithEmails(stubModel(), stubModel(), "a@b.com", "bad name"),
    /letters, numbers, and underscores/
  );
});

test("rejects an over-length username", async () => {
  await assert.rejects(
    createUsersWithEmails(stubModel(), stubModel(), "a@b.com", "a".repeat(51)),
    /cannot exceed/
  );
});

test("rejects a missing username before validation", async () => {
  await assert.rejects(
    createUsersWithEmails(stubModel(), stubModel(), "a@b.com", ""),
    /required/
  );
});

test("still reserves bot- usernames", async () => {
  await assert.rejects(
    createUsersWithEmails(stubModel(), stubModel(), "a@b.com", "bot-evil"),
    /reserved/
  );
});

test("enforces the configured account minimum before database access", async () => {
  await assert.rejects(
    createUsersWithEmails(
      stubModel(),
      stubModel(),
      "a@b.com",
      "valid_name",
      "2015-01-01",
      {
        accountAgeGateEnabled: true,
        minimumAccountAge: 13,
        sensitiveContentAgeGateEnabled: true,
        minimumSensitiveContentAge: 18,
      }
    ),
    /MINIMUM_AGE_NOT_MET/
  );
});

test("persists birthday only through account creation", async () => {
  let createdInput: any;
  let findCount = 0;
  const User = {
    find: async () => {
      findCount += 1;
      return findCount === 1 ? [] : [{ username: "adult_user" }];
    },
    create: async ({ input }: any) => {
      createdInput = input;
      return { users: input };
    },
  } as any;
  const Email = { find: async () => [] } as any;

  await createUsersWithEmails(
    User,
    Email,
    "adult@example.com",
    "adult_user",
    "2000-01-01"
  );

  assert.equal(createdInput[0].dateOfBirth, "2000-01-01");
});
