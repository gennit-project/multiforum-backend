import assert from "node:assert/strict";
import test from "node:test";
import getOwnEmail from "./getOwnEmail.js";
import type { AccountRegistrationRepository, OwnAccountSummary } from "../../services/persistence/accountRegistrationRepository.js";
import type { GraphQLContext } from "../../types/context.js";
const context = (email: string | null): GraphQLContext => ({user:{username:"identity",email,email_verified:true}} as GraphQLContext);
const setup = (rows: OwnAccountSummary[] = [], failure?: unknown) => {
  const calls: string[] = [];
  const resolver = getOwnEmail({accountRegistrationRepository:{findOwnAccountSummary:async(address:string)=>{
    calls.push(address); if(failure) throw failure; return rows;
  }} as AccountRegistrationRepository});
  return {calls,resolver};
};
test("own summary is scoped to identity email and preserves onboarding fallback", async()=>{
  const state=setup();
  assert.equal(await state.resolver(null,{address:"other@example.test"},context(null),{} as never),null);
  assert.deepEqual(state.calls,[]);
  assert.deepEqual(await state.resolver(null,{address:"other@example.test"},context("self@example.test"),{} as never),{
    address:"self@example.test",username:null,profilePicURL:null,modProfileName:null,unreadNotificationCount:null,
  });
  assert.deepEqual(state.calls,["self@example.test"]);
});
test("own summary maps the first row and preserves zero unread count",async()=>{
  const state=setup([{address:"stored@example.test",User:{username:"self",profilePicURL:"image",ModerationProfile:{displayName:"mod"},NotificationsAggregate:{count:0}}}]);
  assert.deepEqual(await state.resolver(null,{},context("self@example.test"),{} as never),{address:"stored@example.test",username:"self",profilePicURL:"image",modProfileName:"mod",unreadNotificationCount:0});
});
test("own summary preserves error wrapping",async()=>{
  for (const failure of [new Error("lookup failed"),"lookup failed"]) {
    await assert.rejects(setup([],failure).resolver(null,{},context("self@example.test"),{} as never),{message:"Failed to get own email: lookup failed"});
  }
});
