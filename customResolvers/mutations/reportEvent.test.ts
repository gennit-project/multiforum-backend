import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import type { Driver } from "neo4j-driver";
import reportEventResolver from "./reportEvent.js";
import type { GraphQLContext } from "../../types/context.js";
import type { GraphQLResolveInfo } from "graphql";

type FindArgs = {
  where?: Record<string, unknown>;
};

class ModelStub {
  findCalls: FindArgs[] = [];
  createCalls: Array<Record<string, any>> = [];
  updateCalls: Array<Record<string, any>> = [];

  constructor(private findImpl: (args: FindArgs) => any[] = () => []) {}

  async find(args: FindArgs) {
    this.findCalls.push(args);
    return this.findImpl(args);
  }

  async create(args: Record<string, any>) {
    this.createCalls.push(args);
    return {
      issues: [
        {
          id: "issue-1",
          issueNumber: 1,
          flaggedServerRuleViolation: false,
        },
      ],
    };
  }

  async update(args: Record<string, any>) {
    this.updateCalls.push(args);
    return {
      issues: [
        {
          id: args.where?.id ?? "issue-1",
          issueNumber: 1,
          flaggedServerRuleViolation:
            args.update?.flaggedServerRuleViolation ?? false,
        },
      ],
    };
  }
}

const createDriver = () => ({
  session: () => ({
    executeWrite: async () => ({
      records: [
        {
          get: () => 1,
        },
      ],
    }),
    close: async () => {},
  }),
}) as unknown as Driver;

const requestIdentityRepository = {
  findByUsername: async () => ({
    username: "alice",
    dateOfBirth: null,
    modProfileName: "mod-alice",
  }),
  findByEmail: async () => null,
  userExists: async () => true,
};

const createUserModel = () =>
  new ModelStub(({ where }) => {
    if (where?.username === "alice") {
      return [
        {
          ModerationProfile: {
            displayName: "mod-alice",
          },
        },
      ];
    }

    return [];
  });

const createContext = () => ({
  req: {
    headers: {
      authorization: `Bearer ${jwt.sign(
        {
          email: "alice@example.com",
          username: "alice",
        },
        "test-secret"
      )}`,
    },
  },
  ogm: {
    model: (name: string) => {
      if (name === "User") {
        return createUserModel();
      }
      throw new Error(`Unexpected model lookup: ${name}`);
    },
  },
  driver: createDriver(),
  requestIdentityRepository,
}) as unknown as GraphQLContext;

test("reportEvent creates an issue and reopens it with a report activity item", async () => {
  process.env.PLAYWRIGHT_MOCK_AUTH = "true";

  const Issue = new ModelStub(() => []);
  const Event = new ModelStub(() => [
    {
      id: "event-1",
      title: "An event to report",
    },
  ]);

  const resolver = reportEventResolver({
    eventReportRepository: {
      findExisting: (channelUniqueName, eventId) => Issue.find({where:{channelUniqueName,relatedEventId:eventId}}),
      findEvent: eventId => Event.find({where:{id:eventId}}),
      createIssue: input => Issue.create({input:[input]}),
      appendReport: (where, update) => Issue.update({where,update}),
    },
    driver: createDriver(),
  });

  const result = await resolver(
    null,
    {
      eventId: "event-1",
      selectedForumRules: ["Be kind"],
      selectedServerRules: [],
      reportText: "Please review this event.",
      channelUniqueName: "cats",
    },
    createContext(),
    null as unknown as GraphQLResolveInfo
  );

  assert.equal(result?.id, "issue-1");
  assert.equal(Issue.createCalls.length, 1);
  assert.equal(Issue.createCalls[0].input[0].relatedEventId, "event-1");
  assert.equal(Issue.createCalls[0].input[0].issueNumber, 1);
  assert.equal(Issue.updateCalls[0].where.id, "issue-1");
  assert.equal(Issue.updateCalls[0].update.isOpen, true);
  assert.equal(Issue.updateCalls[0].update.flaggedServerRuleViolation, false);
  assert.equal(
    Issue.updateCalls[0].update.ActivityFeed[0].create[0].node.actionType,
    "report"
  );
});

test("reportEvent reuses existing issues and preserves server-rule flagging", async () => {
  process.env.PLAYWRIGHT_MOCK_AUTH = "true";

  const Issue = new ModelStub(({ where }) => {
    if (where?.relatedEventId === "event-1") {
      return [
        {
          id: "existing-issue",
          issueNumber: 7,
          flaggedServerRuleViolation: true,
        },
      ];
    }

    return [];
  });
  const Event = new ModelStub(() => []);

  const resolver = reportEventResolver({
    eventReportRepository: {
      findExisting: (channelUniqueName, eventId) => Issue.find({where:{channelUniqueName,relatedEventId:eventId}}),
      findEvent: eventId => Event.find({where:{id:eventId}}),
      createIssue: input => Issue.create({input:[input]}),
      appendReport: (where, update) => Issue.update({where,update}),
    },
    driver: createDriver(),
  });

  await resolver(
    null,
    {
      eventId: "event-1",
      selectedForumRules: ["Be kind"],
      selectedServerRules: [],
      reportText: "Please review this event.",
      channelUniqueName: "cats",
    },
    createContext(),
    null as unknown as GraphQLResolveInfo
  );

  assert.equal(Issue.createCalls.length, 0);
  assert.equal(Event.findCalls.length, 0);
  assert.equal(Issue.updateCalls[0].where.id, "existing-issue");
  assert.equal(Issue.updateCalls[0].update.isOpen, true);
  assert.equal(Issue.updateCalls[0].update.flaggedServerRuleViolation, true);
});

test("reportEvent flags new issues for server-rule violations", async () => {
  process.env.PLAYWRIGHT_MOCK_AUTH = "true";

  const Issue = new ModelStub(() => []);
  const Event = new ModelStub(() => [
    {
      id: "event-1",
      title: "An event to report",
    },
  ]);

  const resolver = reportEventResolver({
    eventReportRepository: {
      findExisting: (channelUniqueName, eventId) => Issue.find({where:{channelUniqueName,relatedEventId:eventId}}),
      findEvent: eventId => Event.find({where:{id:eventId}}),
      createIssue: input => Issue.create({input:[input]}),
      appendReport: (where, update) => Issue.update({where,update}),
    },
    driver: createDriver(),
  });

  await resolver(
    null,
    {
      eventId: "event-1",
      selectedForumRules: [],
      selectedServerRules: ["No spam"],
      reportText: "Please review this event.",
      channelUniqueName: "cats",
    },
    createContext(),
    null as unknown as GraphQLResolveInfo
  );

  assert.equal(Issue.createCalls[0].input[0].flaggedServerRuleViolation, true);
  assert.equal(Issue.updateCalls[0].update.flaggedServerRuleViolation, true);
});

const validArgs = {eventId:'event-1', channelUniqueName:'cats', selectedForumRules:['Kind'], selectedServerRules:[], reportText:'report'};
const info = null as unknown as GraphQLResolveInfo;
test('reportEvent validates before identity or persistence', async () => {
 const calls:string[]=[];
 const repository={findExisting:async()=>{calls.push('find');return[];},findEvent:async()=>[],createIssue:async()=>({issues:[]}),appendReport:async()=>({issues:[]})};
 const resolve=reportEventResolver({driver:createDriver(),eventReportRepository:repository});
 for(const [args,message] of [[{...validArgs,eventId:''},'Event ID is required'],[{...validArgs,channelUniqueName:''},'Channel unique name is required'],[{...validArgs,selectedForumRules:[]},'At least one rule must be selected']] as Array<[typeof validArgs,string]>){
  await assert.rejects(resolve(null,args,{} as GraphQLContext,info),new RegExp(message));
 }
 assert.deepEqual(calls,[]);
});
test('reportEvent preserves read and allocation errors outside write catches',async()=>{
 process.env.PLAYWRIGHT_MOCK_AUTH='true';
 for(const failure of ['existing','event','allocate']){
  const order:string[]=[];
  const repository={findExisting:async()=>{order.push('existing');if(failure==='existing')throw Error('existing failed');return[];},findEvent:async()=>{order.push('event');if(failure==='event')throw Error('event failed');return[];},createIssue:async()=>{order.push('create');return{issues:[]};},appendReport:async()=>{order.push('append');return{issues:[]};}};
  const driver={session:()=>({executeWrite:async()=>{order.push('allocate');throw Error('allocate failed');},close:async()=>{order.push('close');}})} as unknown as Driver;
  await assert.rejects(reportEventResolver({driver,eventReportRepository:repository})(null,validArgs,createContext(),info),new RegExp(failure+' failed'));
  assert.deepEqual(order,failure==='existing'?['existing']:failure==='event'?['existing','event']:['existing','event','allocate','close']);
 }
});
test('reportEvent catches create failures and empty results without attempting activity',async()=>{
 process.env.PLAYWRIGHT_MOCK_AUTH='true';
 for(const throws of [false,true]){
  const order:string[]=[];
  const repository={findExisting:async()=>[],findEvent:async()=>[],createIssue:async()=>{order.push('create');if(throws)throw Error('internal');return{issues:[]};},appendReport:async()=>{order.push('append');return{issues:[]};}};
  await assert.rejects(reportEventResolver({driver:createDriver(),eventReportRepository:repository})(null,validArgs,createContext(),info),/Error creating issue/);
  assert.deepEqual(order,['create']);
 }
});
test('reportEvent catches activity failures and empty results after selecting existing issue',async()=>{
 process.env.PLAYWRIGHT_MOCK_AUTH='true';
 for(const throws of [false,true]){
  const order:string[]=[];
  const repository={findExisting:async()=>[{id:'existing',issueNumber:3}],findEvent:async()=>{order.push('event');return[];},createIssue:async()=>{order.push('create');return{issues:[]};},appendReport:async()=>{order.push('append');if(throws)throw Error('internal');return{issues:[]};}};
  await assert.rejects(reportEventResolver({driver:createDriver(),eventReportRepository:repository})(null,validArgs,createContext(),info),/Error updating issue/);
  assert.deepEqual(order,['append']);
 }
});
