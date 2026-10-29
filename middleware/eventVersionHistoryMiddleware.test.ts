import {buildSchema, parse} from 'graphql';
import {registerGeneratedSchema} from '../services/persistence/generatedSchemaOperations.js';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import middleware from './eventVersionHistoryMiddleware.js';

for (const outcome of ['success', 'resolve-failure', 'history-failure', 'noop', 'retry']) {
  test(`event transaction ${outcome} preserves write and effect ordering`, async () => {
    const calls: string[] = [];
    const tx = {};
    const snapshot = {id:'e', title:'old', Poster:{username:'editor'}};
    const context: any = {
      driver: {session: () => ({
        executeWrite: async (work: any) => {
          if (outcome === 'retry') {await work(tx); calls.push('rollback');}
          const result = await work(tx); calls.push('commit'); return result;
        }, close: async () => {calls.push('close');},
      })},
      user:{username:'editor'},
      eventRevisionRepository: {
        lockSnapshot: async () => {calls.push('lock'); return snapshot;},
        recordChanges: async () => {calls.push('history'); if(outcome==='history-failure')throw Error('history failure');return outcome==='noop'?[]:[{id:'v',type:'title'}];},
      },
      issueActivityRepository:{findRelatedIssueIds:async()=>{calls.push('activity');return [];}}
    };
    const schema = buildSchema('input EventWhere {id: IdFilter} input IdFilter {in:[ID!]} type Query {events(where:EventWhere):[Event!]!} type Event {id:ID!}');
    schema.getQueryType()!.getFields().events.resolve=()=>[{id:'e'}];
    registerGeneratedSchema(context.driver,schema);
    const operation: any = parse('mutation {updateEvents {events {id}}}').definitions[0];
    const info: any = {fieldNodes:operation.selectionSet.selections, operation, fragments:{}, variableValues:{}};
    const resolve = async (_p: unknown, _a: unknown, ctx: any) => {
      assert.equal(ctx.executionContext,tx);calls.push('resolve');
      if(outcome==='resolve-failure')throw Error('resolve failure');return {events:[{id:'e'}]};
    };
    const pending = middleware.Mutation.updateEvents(resolve,null,{where:{id:{eq:'e'}},update:{title:{set:'new'}}},context,info);
    if(outcome.endsWith('failure')) {
      await assert.rejects(pending,/failure/); assert.ok(!calls.includes('commit')); assert.ok(!calls.includes('activity'));
    } else {
      assert.equal((await pending as any).events[0].id,'e');
      assert.deepEqual(calls, outcome==='noop'?['lock','resolve','history','commit','close']:outcome==='retry'?['lock','resolve','history','rollback','lock','resolve','history','commit','close','activity']:['lock','resolve','history','commit','close','activity']);
    }
  });
}
