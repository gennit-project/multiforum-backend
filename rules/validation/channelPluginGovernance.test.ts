import assert from 'node:assert/strict'
import test from 'node:test'
import { validateChannelPluginWrites } from './channelPluginGovernance.js'
test('generated channel mutations reject governed connect/update and unsafe nested creation',async()=>{
  for(const input of [
    [{connect:[{where:{node:{id:{eq:'moderation'}}},edge:{enabled:true}}]}],
    [{update:{where:{node:{id:{eq:'moderation'}}},edge:{enabled:{set:true}}}}],
    [{create:[{node:{}}]}], [{update:{node:{Plugin:[]}}}],
  ]) assert.equal(typeof await validateChannelPluginWrites(input,async()=>true),'string')
})
test('broad selectors cannot bypass matching and ordinary plugins remain supported',async()=>{
  let where:unknown
  assert.equal(typeof await validateChannelPluginWrites([{connect:[{edge:{enabled:true}}]}],async value=>{where=value;return true}),'string')
  assert.deepEqual(where,{})
  assert.equal(await validateChannelPluginWrites([{connect:[{where:{node:{id:{eq:'other'}}}}]}],async()=>false),true)
  assert.equal(await validateChannelPluginWrites([{disconnect:[{where:{node:{id:{eq:'moderation'}}}}]}],async()=>{throw Error('must not query')}),true)
})
