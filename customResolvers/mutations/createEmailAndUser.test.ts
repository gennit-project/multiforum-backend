import test from "node:test";
import assert from "node:assert/strict";
import { isDate } from "neo4j-driver";
import { createUsersWithEmails } from "./createEmailAndUser.js";

// Validation runs before any DB access, so these stubs are never reached.
const stubRepository = () =>
  ({
    findExistingUsername: async () => [],
    findExistingEmail: async () => [],
    createAccount: async () => {},
    findCreatedAccount: async () => [{ username: "x" }],
  }) as any;

test("rejects a username with invalid characters", async () => {
  await assert.rejects(
    createUsersWithEmails(stubRepository(), "a@b.com", "bad name"),
    /letters, numbers, and underscores/
  );
});

test("rejects an over-length username", async () => {
  await assert.rejects(
    createUsersWithEmails(stubRepository(), "a@b.com", "a".repeat(51)),
    /cannot exceed/
  );
});

test("rejects a missing username before validation", async () => {
  await assert.rejects(
    createUsersWithEmails(stubRepository(), "a@b.com", ""),
    /required/
  );
});

test("still reserves bot- usernames", async () => {
  await assert.rejects(
    createUsersWithEmails(stubRepository(), "a@b.com", "bot-evil"),
    /reserved/
  );
});

test("enforces the configured account minimum before database access", async () => {
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
      }
    ),
    /MINIMUM_AGE_NOT_MET/
  );
});

test("persists birthday only through account creation", async () => {
  let createdInput: any;
  const repository = {
    findExistingUsername: async () => [],
    findExistingEmail: async () => [],
    createAccount: async (input: any) => { createdInput = input; },
    findCreatedAccount: async () => [{username: "adult_user"}],
    findOwnAccountSummary: async () => [],
  };
  await createUsersWithEmails(repository, "adult@example.com", "adult_user", "2000-01-01");

  assert.equal(isDate(createdInput.dateOfBirth), true);
  assert.equal(createdInput.dateOfBirth.toString(), "2000-01-01");
});

test("registration preserves existence/create/read ordering and stops at each failure", async () => {
  for (const failing of ["username", "email", "create", "created", "missing", "none"]) {
    const calls: string[] = [];
    const failure = new Error("database failed");
    const repository = {
      findExistingUsername: async () => { calls.push("username"); return failing === "username" ? [{}] : []; },
      findExistingEmail: async () => { calls.push("email"); return failing === "email" ? [{}] : []; },
      createAccount: async () => { calls.push("create"); if (failing === "create") throw failure; },
      findCreatedAccount: async () => { calls.push("created"); if (failing === "created") throw failure; return failing === "missing" ? [] : [{username:"new_user"}]; },
      findOwnAccountSummary: async () => [],
    };
    const work = createUsersWithEmails(repository,"new@example.test","new_user");
    if (failing === "none") assert.deepEqual(await work,{username:"new_user"});
    else await assert.rejects(work, failing === "username" ? /Username already taken/ : failing === "email" ? /Email already taken/ : failing === "missing" ? /Error creating user and linking email/ : error => error === failure);
    assert.deepEqual(calls, failing === "username" ? ["username"] : failing === "email" ? ["username","email"] : failing === "create" ? ["username","email","create"] : ["username","email","create","created"]);
  }
});

test("registration resolver uses verified email spelling and rejects mismatches before persistence", async () => {
  const { default: createResolver } = await import("./createEmailAndUser.js");
  const addresses: string[] = [];
  const repository = { ...stubRepository(),
    findExistingEmail: async (address: string) => { addresses.push(address); return []; },
  };
  const resolver = createResolver({accountRegistrationRepository:repository,agePolicyRepository:{findAgePolicyConfigs:async()=>[]}});
  const context = { user:{username:"verified_identity",email:"Verified@Example.test",email_verified:true} } as never;
  await resolver(null,{username:"new_user",emailAddress:"verified@example.TEST"},context,{} as never);
  assert.deepEqual(addresses,["Verified@Example.test"]);
  await assert.rejects(resolver(null,{username:"new_user",emailAddress:"different@example.test"},context,{} as never), /Account email must match the verified login/);
  await assert.rejects(resolver(null,{username:"new_user",emailAddress:"verified@example.test"},{user:{username:"verified_identity",email:"Verified@Example.test",email_verified:false}} as never,{} as never), /A verified login is required/);
  assert.equal(addresses.length,1);
});

test("Cypress identity and admin role inputs remain unchanged", async () => {
  const oldName=process.env.SERVER_CONFIG_NAME;
  const oldEmail=process.env.CYPRESS_ADMIN_TEST_EMAIL;
  process.env.SERVER_CONFIG_NAME="Cypress Test Server";
  process.env.CYPRESS_ADMIN_TEST_EMAIL="admin@example.test";
  let created: any;
  try {
    const repository={...stubRepository(),createAccount:async(input:unknown)=>{created=input;}};
    await createUsersWithEmails(repository,"admin@example.test","alice");
    assert.equal(created.ModerationProfile.create.node.displayName,"testModProfile2");
    assert.deepEqual(created.ServerRoles,{connect:[{where:{node:{name:"Admin Role"}}}]});
    assert.equal(created.Email.create.node.address,"admin@example.test");
  } finally {
    if(oldName===undefined) delete process.env.SERVER_CONFIG_NAME;else process.env.SERVER_CONFIG_NAME=oldName;
    if(oldEmail===undefined) delete process.env.CYPRESS_ADMIN_TEST_EMAIL;else process.env.CYPRESS_ADMIN_TEST_EMAIL=oldEmail;
  }
});
