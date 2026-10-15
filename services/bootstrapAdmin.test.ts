import assert from "node:assert/strict";
import test from "node:test";
import { provisionBootstrapAdmin } from "./bootstrapAdmin.js";
import type {
  BootstrapAdminRepository,
  BootstrapAdminResult,
} from "./persistence/bootstrapAdminRepository.js";

const baseInput = () => ({
  serverName: "Community Forum",
  email: "admin@example.test",
  username: "admin",
});

const repositoryReturning = (
  result: BootstrapAdminResult,
  calls: unknown[] = []
): BootstrapAdminRepository => ({
  async reconcile(input) {
    calls.push(input);
    return result;
  },
});

test("delegates reconciliation and logs a newly created admin", async () => {
  const calls: unknown[] = [];
  const messages: string[] = [];
  const result = await provisionBootstrapAdmin({
    ...baseInput(),
    repository: repositoryReturning(
      { status: "created", username: "admin" },
      calls
    ),
    log: (message) => messages.push(message),
  });

  assert.deepEqual(calls, [baseInput()]);
  assert.deepEqual(result, { status: "created", username: "admin" });
  assert.deepEqual(messages, [
    "Created bootstrap user 'admin'.",
    "Connected bootstrap user 'admin' as a SuperAdmin.",
  ]);
});

for (const testCase of [
  {
    result: { status: "connected", username: "admin" } as const,
    message: "Connected bootstrap user 'admin' as a SuperAdmin.",
  },
  {
    result: { status: "unchanged", username: "admin" } as const,
    message: "Bootstrap user 'admin' is already a SuperAdmin.",
  },
  {
    result: { status: "skipped", reason: "database-not-empty" } as const,
    message: "Skipped bootstrap admin: the database already contains users.",
  },
]) {
  test(`logs the ${testCase.result.status} outcome`, async () => {
    const messages: string[] = [];
    const result = await provisionBootstrapAdmin({
      ...baseInput(),
      repository: repositoryReturning(testCase.result),
      log: (message) => messages.push(message),
    });

    assert.deepEqual(result, testCase.result);
    assert.deepEqual(messages, [testCase.message]);
  });
}

test("does not log when reconciliation fails", async () => {
  const messages: string[] = [];
  await assert.rejects(
    provisionBootstrapAdmin({
      ...baseInput(),
      repository: {
        async reconcile() {
          throw new Error("identity collision");
        },
      },
      log: (message) => messages.push(message),
    }),
    /identity collision/
  );
  assert.deepEqual(messages, []);
});
