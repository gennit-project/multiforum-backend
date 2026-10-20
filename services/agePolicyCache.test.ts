import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import {
  AGE_POLICY_CACHE_TTL_MS,
  invalidateAgePolicyCache,
  loadCachedAgePolicy,
} from "./agePolicyCache.js";

const createReader = (enabled = true) => {
  let finds = 0;
  let current = enabled;
  return {
    agePolicyRepository: {
      findAgePolicyConfigs: async () => {
        finds += 1;
        return [{
          accountAgeGateEnabled: false,
          minimumAccountAge: 13,
          sensitiveContentAgeGateEnabled: current,
          minimumSensitiveContentAge: 18,
        }];
      },
    } as any,
    finds: () => finds,
    setEnabled: (value: boolean) => { current = value; },
  };
};

beforeEach(() => {
  invalidateAgePolicyCache();
});

test("serves repeated requests from one policy load", async () => {
  const reader = createReader();
  await loadCachedAgePolicy({ agePolicyRepository: reader.agePolicyRepository, serverName: "s", now: 0 });
  await loadCachedAgePolicy({ agePolicyRepository: reader.agePolicyRepository, serverName: "s", now: 1_000 });

  assert.equal(reader.finds(), 1);
});

test("shares one load between concurrent requests", async () => {
  const reader = createReader();
  await Promise.all([
    loadCachedAgePolicy({ agePolicyRepository: reader.agePolicyRepository, serverName: "s", now: 0 }),
    loadCachedAgePolicy({ agePolicyRepository: reader.agePolicyRepository, serverName: "s", now: 0 }),
  ]);

  assert.equal(reader.finds(), 1);
});

test("reloads after the TTL expires", async () => {
  const reader = createReader();
  await loadCachedAgePolicy({ agePolicyRepository: reader.agePolicyRepository, serverName: "s", now: 0 });
  await loadCachedAgePolicy({ agePolicyRepository: reader.agePolicyRepository, serverName: "s", now: AGE_POLICY_CACHE_TTL_MS });

  assert.equal(reader.finds(), 2);
});

test("applies a changed policy immediately after invalidation", async () => {
  const reader = createReader(false);
  await loadCachedAgePolicy({ agePolicyRepository: reader.agePolicyRepository, serverName: "s", now: 0 });
  reader.setEnabled(true);
  invalidateAgePolicyCache();

  const policy = await loadCachedAgePolicy({ agePolicyRepository: reader.agePolicyRepository, serverName: "s", now: 1 });

  assert.equal(policy.sensitiveContentAgeGateEnabled, true);
});

test("does not share entries between server names", async () => {
  const reader = createReader();
  await loadCachedAgePolicy({ agePolicyRepository: reader.agePolicyRepository, serverName: "a", now: 0 });
  await loadCachedAgePolicy({ agePolicyRepository: reader.agePolicyRepository, serverName: "b", now: 0 });

  assert.equal(reader.finds(), 2);
});

test("does not cache a failed load", async () => {
  let calls = 0;
  const agePolicyRepository = {
    findAgePolicyConfigs: async () => {
      calls += 1;
      if (calls === 1) throw new Error("db down");
      return [];
    },
  } as any;
  await assert.rejects(loadCachedAgePolicy({ agePolicyRepository, serverName: "s", now: 0 }));
  await loadCachedAgePolicy({ agePolicyRepository, serverName: "s", now: 1 });

  assert.equal(calls, 2);
});
