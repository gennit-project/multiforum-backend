import assert from 'node:assert/strict';
import test from 'node:test';
import type {Driver} from 'neo4j-driver';
import {createPipelineSummaryPageRepository} from './pipelineSummaryPageRepository.js';

test('ambiguous legacy identifiers reject without selecting an arbitrary target', async () => {
  const calls: {query:string; parameters:unknown}[] = [];
  let closed = 0;
  const driver = {session:()=>({
    run:async(query:string,parameters:unknown)=>{
      calls.push({query,parameters});
      return {records:calls.length===1 ? [] : [{get:()=>({id:'visible'})},{get:()=>({id:'hidden'})}]};
    },
    close:async()=>{closed++;},
  })} as unknown as Driver;
  await assert.rejects(createPipelineSummaryPageRepository(driver).findAttempt('legacy'), /Pipeline run not found/);
  assert.equal(calls.length,2);
  assert.match(calls[1].query, /LIMIT 2/);
  assert.deepEqual(calls[1].parameters,{pipelineId:'legacy'});
  assert.equal(closed,2);
});
