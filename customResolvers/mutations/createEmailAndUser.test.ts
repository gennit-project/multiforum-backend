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
