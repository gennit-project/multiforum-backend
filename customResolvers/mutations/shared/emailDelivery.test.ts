import assert from "node:assert/strict";
import test, { before, after, afterEach, mock } from "node:test";
import sgMail from "@sendgrid/mail";
import { Resend } from "resend";
import { sendEmailToUser } from "./emailUtils.js";
import inviteForumOwner from "../inviteForumOwner.js";
import inviteForumMod from "../inviteForumMod.js";
import inviteServerAdmin from "../inviteServerAdmin.js";
import inviteServerMod from "../inviteServerMod.js";
import type { EmailNotificationRepository } from "../../../services/persistence/emailNotificationRepository.js";

let nativeCalls=0;
const envKeys=["EMAIL_FROM","EMAIL_PROVIDER","RESEND_API_KEY","SENDGRID_API_KEY"] as const;
const saved=new Map<string,string|undefined>();
before(()=>{
 for(const key of envKeys) saved.set(key,process.env[key]);
 process.env.EMAIL_FROM="test@example.test";process.env.EMAIL_PROVIDER="resend";
 process.env.RESEND_API_KEY="fake-test-key";process.env.SENDGRID_API_KEY="fake-test-key";
 mock.method(sgMail,"send",async()=>{nativeCalls++;throw new Error("Native SendGrid delivery forbidden in test");});
 mock.method(Resend.prototype,"post",async()=>{nativeCalls++;throw new Error("Native Resend delivery forbidden in test");});
});
afterEach(()=>assert.equal(nativeCalls,0,"all deliveries must use the injected fake sender"));
after(()=>{
 mock.restoreAll();for(const key of envKeys){const value=saved.get(key);if(value===undefined) delete process.env[key];else process.env[key]=value;}
});
const content={subject:"Subject",plainText:"Text",html:"<p>Text</p>"};
const setup=(failure?:string)=>{
 const order:string[]=[];const messages:unknown[]=[];
 const emailNotificationRepository:EmailNotificationRepository={
  async findRecipient(username){order.push("recipient");assert.equal(username,"recipient");
   if(failure==="lookup") throw new Error("lookup failed");
   return failure==="missing"?[]:[{username,Email:failure==="address"?null:{address:"recipient@example.test"}}];},
  async createAfterEmailNotification(username,text){order.push("notification");assert.equal(username,"recipient");assert.equal(text,"Notice");
   if(failure==="notification") throw new Error("write failed");return failure!=="no-match";},
 };
 return{order,messages,emailDelivery:{emailNotificationRepository,sendMail:async(message:unknown)=>{
  order.push("email");messages.push(message);if(failure==="email-throw")throw new Error("delivery failed");return failure!=="email-false";
 }}};
};
test("email delivery precedes optional in-app write and preserves its payload",async()=>{
 const state=setup();assert.equal(await sendEmailToUser("recipient",content,state.emailDelivery,{createInAppNotification:true,inAppText:"Notice"}),true);
 assert.deepEqual(state.order,["recipient","email","notification"]);
 assert.deepEqual(state.messages,[{to:"recipient@example.test",subject:"Subject",text:"Text",html:"<p>Text</p>"}]);
 const noNotification=setup();assert.equal(await sendEmailToUser("recipient",content,noNotification.emailDelivery),true);
 assert.deepEqual(noNotification.order,["recipient","email"]);
});
test("delivery and persistence failures retain false-return and stopping boundaries",async()=>{
 for(const failure of ["lookup","missing","address","email-false","email-throw","notification","no-match"]){
  const state=setup(failure);assert.equal(await sendEmailToUser("recipient",content,state.emailDelivery,{createInAppNotification:true,inAppText:"Notice"}),false);
  assert.deepEqual(state.order,["lookup","missing","address"].includes(failure)?["recipient"]:failure.startsWith("email")?["recipient","email"]:["recipient","email","notification"]);
 }
});
for(const [name,factory] of Object.entries({inviteForumOwner,inviteForumMod,inviteServerAdmin,inviteServerMod})){
 test(`${name} retains invite-write then delivery and existing best-effort result`,async()=>{
  for(const delivered of [true,false]){
   const order:string[]=[];
   const repository:EmailNotificationRepository={findRecipient:async()=>{order.push("recipient");return[{username:"recipient",Email:{address:"recipient@example.test"}}];},createAfterEmailNotification:async()=>{order.push("notification");return true;}};
   const resolver=factory({driver:{} as never,
    forumInvitationRepository:{
     connectOwnerInvite:async()=>{order.push("invite");return{channels:[{}]};},
     connectModeratorInvite:async()=>{order.push("invite");return{channels:[{}]};},
    },
    serverInvitationRepository:{
     findInvitee:async()=>{order.push("exists");return[{username:"recipient"}];},
     connectAdminInvite:async()=>{order.push("invite");return{serverConfigs:[{}]};},
     connectModeratorInvite:async()=>{order.push("invite");return{serverConfigs:[{}]};},
    },
    emailDelivery:{emailNotificationRepository:repository,sendMail:async()=>{order.push("email");return delivered;}},
   } as never);
   const result=await resolver(null,{inviteeUsername:"recipient",channelUniqueName:"channel",serverName:"server"},{} as never,{} as never);
   assert.equal(result,name.includes("Server")?true:delivered);
   assert.deepEqual(order,[...(name.includes("Server")?["exists"]:[]),"invite","recipient","email",...(delivered?["notification"]:[])]);
  }
 });
}

for(const factory of [inviteForumOwner,inviteForumMod])test(`${factory.name} forum invite persistence failures stop before delivery`,async()=>{
 for(const fails of [true,false]){
  const order:string[]=[];
  const fail=async()=>{order.push("invite");if(fails)throw new Error("invite write failed");return{channels:[]};};
  const resolver=factory({driver:{} as never,forumInvitationRepository:{connectOwnerInvite:fail,connectModeratorInvite:fail},emailDelivery:{
   emailNotificationRepository:{findRecipient:async()=>{order.push("recipient");return[];},createAfterEmailNotification:async()=>{order.push("notification");return true;}},sendMail:async()=>{order.push("email");return true;},
  }});
  assert.equal(await resolver(null,{inviteeUsername:"recipient",channelUniqueName:"channel"},{} as never,{} as never),false);
  assert.deepEqual(order,["invite"]);
 }
});

for(const [name,factory] of Object.entries({inviteServerAdmin,inviteServerMod}))test(`${name} rejects lookup/write failures before best-effort delivery`,async()=>{
 for(const failure of ["lookup","missing-user","write","missing-server"]){
  const order:string[]=[];
  const write=async()=>{order.push("invite");if(failure==="write")throw new Error("write failed");return{serverConfigs:[]};};
  const resolver=factory({driver:{} as never,serverInvitationRepository:{findInvitee:async()=>{order.push("exists");if(failure==="lookup")throw new Error("lookup failed");return failure==="missing-user"?[]:[{username:"recipient"}];},connectAdminInvite:write,connectModeratorInvite:write},emailDelivery:{emailNotificationRepository:{findRecipient:async()=>{order.push("recipient");return[];},createAfterEmailNotification:async()=>true},sendMail:async()=>{order.push("email");return true;}}});
  await assert.rejects(resolver(null,{serverName:"server",inviteeUsername:"recipient"},{} as never,{} as never),{message:failure==="lookup"?"lookup failed":failure==="missing-user"?'No user exists with username "recipient".':failure==="write"?"write failed":'No server exists with name "server".'});
  assert.deepEqual(order,failure==="lookup"||failure==="missing-user"?["exists"]:["exists","invite"]);
 }
});
