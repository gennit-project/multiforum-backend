import assert from 'node:assert/strict';
import {after,before,beforeEach,test} from 'node:test';
import type {Driver} from 'neo4j-driver';
import {readScratchpadSuperVoters} from '../../services/persistence/scratchpadSuperVoters.js';
import {scratchpadSuperVoterSelection} from '../../customResolvers/contracts/scratchpadSuperVoters.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';
let driver:Driver;
before(async()=>{driver=await startNeo4j();},{timeout:240000});
after(async()=>stopNeo4j());
beforeEach(async()=>resetDatabase(driver));
for(const sourceType of ['comment','discussion'] as const) {
 const label=sourceType==='comment'?'Comment':'DiscussionChannel';
 const relationship=sourceType==='comment'?'SUPER_UPVOTED_COMMENT':'SUPER_UPVOTED_DISCUSSION';
 test(`${sourceType} actual voter read retains exact map keys and raw nullable names`,async()=>{
  await driver.executeQuery(`CREATE(t:${label}{id:'target'}),(u:User{username:'actor'}),(missing:User)
   CREATE(u)-[:${relationship}]->(t),(missing)-[:${relationship}]->(t)`);
  const session=driver.session();
  try {
   const rows=await session.executeRead(tx=>readScratchpadSuperVoters(tx,sourceType,'target'));
   assert.equal(rows.length,2);
   for(const row of rows) assert.deepEqual(Object.keys(row),Object.keys(scratchpadSuperVoterSelection));
   assert.deepEqual(rows.map(row=>row.username).sort(),['actor',null].sort());
   assert.deepEqual(await session.executeRead(tx=>readScratchpadSuperVoters(tx,sourceType,'missing')),[]);
  } finally {await session.close();}
 });
 test(`${sourceType} read sees the uncommitted vote and does not commit or reopen a session`,async()=>{
  await driver.executeQuery(`CREATE(:${label}{id:'target'}),(:User{username:'actor'})`);
  const session=driver.session();
  try {
   const tx=session.beginTransaction();
   try {
    await tx.run(`MATCH(u:User{username:'actor'}),(t:${label}{id:'target'}) CREATE(u)-[:${relationship}]->(t)`);
    assert.deepEqual(await readScratchpadSuperVoters(tx,sourceType,'target'),[{username:'actor'}]);
   } finally {await tx.rollback();}
   assert.deepEqual(await session.executeRead(tx=>readScratchpadSuperVoters(tx,sourceType,'target')),[]);
  } finally {await session.close();}
 });
}
