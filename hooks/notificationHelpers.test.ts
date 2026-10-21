import test from "node:test";
import assert from "node:assert/strict";
import { createInAppNotification } from "./notificationHelpers.js";
import type { NotificationInput } from "../services/persistence/notificationWriter.js";

for (const result of [true, false]) {
  test(`returns ${result} when the writer reports ${result}`, async () => {
    const actual = await createInAppNotification({context:{notificationWriter:{createForUser:async()=>result}},username:"alice",text:"hello"});
    assert.equal(actual,result);
  });
}
test("returns false rather than throwing on write failure", async () => {
  assert.equal(await createInAppNotification({context:{notificationWriter:{createForUser:async()=>{throw new Error("db error");}}},username:"alice",text:"hello"}),false);
});
test("targets the recipient and defaults the notification category to general", async () => {
  const calls: NotificationInput[]=[];
  await createInAppNotification({context:{notificationWriter:{createForUser:async input=>{calls.push(input);return true;}}},username:"alice",text:"hello"});
  assert.deepEqual(calls,[{username:"alice",text:"hello",notificationType:"general"}]);
});
test("preserves an explicitly provided notification category", async () => {
  const calls: NotificationInput[]=[];
  await createInAppNotification({context:{notificationWriter:{createForUser:async input=>{calls.push(input);return true;}}},username:"alice",text:"feedback",notificationType:"feedback"});
  assert.deepEqual(calls,[{username:"alice",text:"feedback",notificationType:"feedback"}]);
});
test("missing writer dependencies retain the false-return failure contract",async()=>{
 assert.equal(await createInAppNotification({context:{},username:"alice",text:"hello"}),false);
});
