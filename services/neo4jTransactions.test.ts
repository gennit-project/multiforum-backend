import test from "node:test";
import assert from "node:assert/strict";
import type { Driver, ManagedTransaction } from "neo4j-driver";
import { executeManagedWrite } from "./neo4jTransactions.js";

test("executeManagedWrite returns the callback result and closes the session", async () => {
  const transaction = {} as ManagedTransaction;
  let closeCalls = 0;
  const driver = {
    session() {
      return {
        executeWrite: async (work: (tx: ManagedTransaction) => Promise<string>) =>
          work(transaction),
        close: async () => {
          closeCalls += 1;
        },
      };
    },
  } as unknown as Driver;

  const result = await executeManagedWrite(driver, async (tx) => {
    assert.equal(tx, transaction);
    return "committed";
  });

  assert.equal(result, "committed");
  assert.equal(closeCalls, 1);
});

test("executeManagedWrite closes the session when the callback fails", async () => {
  let closeCalls = 0;
  const driver = {
    session() {
      return {
        executeWrite: async (work: (tx: ManagedTransaction) => Promise<unknown>) =>
          work({} as ManagedTransaction),
        close: async () => {
          closeCalls += 1;
        },
      };
    },
  } as unknown as Driver;

  await assert.rejects(
    executeManagedWrite(driver, async () => {
      throw new Error("write failed");
    }),
    /write failed/
  );
  assert.equal(closeCalls, 1);
});
