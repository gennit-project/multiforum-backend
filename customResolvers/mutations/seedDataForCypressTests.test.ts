import assert from "node:assert/strict";
import test from "node:test";
import type { Driver } from "neo4j-driver";
import { linkSeededChannelRoleOwners } from "./seedDataForCypressTests.js";

test("Cypress seed roles are linked to their scalar owning channels", async () => {
  const queries: string[] = [];
  let closed = false;
  const driver = {
    session: () => ({
      run: async (query: string) => {
        queries.push(query);
        return { records: [] };
      },
      close: async () => {
        closed = true;
      },
    }),
  } as unknown as Driver;

  await linkSeededChannelRoleOwners(driver);

  assert.equal(queries.length, 2);
  assert.match(queries[0], /OWNS_CHANNEL_ROLE/);
  assert.match(queries[1], /OWNS_MOD_CHANNEL_ROLE/);
  assert.equal(closed, true);
});

import getResolver from './seedDataForCypressTests.js';
import type {SeedDataRepository} from '../../services/persistence/seedDataRepository.js';
const emptySeed={channels:[],users:[],tags:[],discussions:[],events:[],comments:[],channelRoles:[],modChannelRoles:[],serverRoles:[],modServerRoles:[],serverConfigs:[]};
function fixture(failAt?:string){const calls:string[]=[];const repository=Object.fromEntries(['createModChannelRoles','createChannelRoles','createModServerRoles','createServerRoles','createServerConfigs','connectDefaultRoles','createChannels','createTags','createComments'].map(name=>[name,async()=>{calls.push(name);if(name===failAt)throw Error('fixture failure');}])) as unknown as SeedDataRepository;const driver={session:()=>({run:async()=>{calls.push('linkOwner');return {records:[]};},close:async()=>{calls.push('close');}})} as unknown as Driver;return {calls,resolver:getResolver({driver,seedDataRepository:repository} as any)};}
test('seed preserves dependency order, owner linking and empty-discussion rejection',async()=>{const {calls,resolver}=fixture();await assert.rejects(resolver({},emptySeed,{} as any,{} as any),/Input cannot be empty/);assert.deepEqual(calls.filter(name=>name!=='close'),['createModChannelRoles','createChannelRoles','createModServerRoles','createServerRoles','createServerConfigs','connectDefaultRoles','createChannels','linkOwner','linkOwner','createTags']);});
test('seed configuration failure retains wrapper and closes session before stopping',async()=>{const {calls,resolver}=fixture('connectDefaultRoles');await assert.rejects(resolver({},emptySeed,{} as any,{} as any),/Failed to update server configurations: fixture failure/);assert.deepEqual(calls,['createModChannelRoles','createChannelRoles','createModServerRoles','createServerRoles','createServerConfigs','connectDefaultRoles','close']);});
test('seed early role failure stops before opening later session',async()=>{const {calls,resolver}=fixture('createChannelRoles');await assert.rejects(resolver({},emptySeed,{} as any,{} as any),/fixture failure/);assert.deepEqual(calls,['createModChannelRoles','createChannelRoles']);});
