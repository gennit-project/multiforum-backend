import assert from 'node:assert/strict';
import test from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import typeDefs from '../../typeDefs.js';
import getResolvers from '../helpers/getTestResolvers.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createBotReportRepository} from '../../services/persistence/botReportRepository.js';
import {createBotReport} from '../../services/botReportService.js';
import {startNeo4j,stopNeo4j} from './neo4jHarness.js';
// Regression: the old append-result path returned stored text despite a validated Int read.
test('bot report returns the validated number without rewriting stored scalar data',async()=>{
 const driver=await startNeo4j();
 try{
  registerGeneratedSchema(driver,await new Neo4jGraphQL({driver,typeDefs,resolvers:getResolvers(driver).resolvers}).getSchema());
  await driver.executeQuery("CREATE(:Channel{uniqueName:'forum',createdAt:datetime()}) CREATE(:Issue{id:'issue',issueNumber:'7',channelUniqueName:'forum',relatedCommentId:'content',isOpen:true,flaggedServerRuleViolation:false,createdAt:datetime()})");
  const repository=createBotReportRepository(driver);
  const read=await repository.findExistingReport({id:{eq:'issue'}});assert.equal(read[0].issueNumber,7);
  const result=await createBotReport({driver,channelUniqueName:'forum',reportInput:{contentType:'comment',contentId:'content',reportText:'Review',selectedForumRules:['rule'],selectedServerRules:[],botName:'helper'}});
  assert.ok(result);assert.equal(result.issueId,'issue');assert.equal(result.issueNumber,7);
  const persisted=await driver.executeQuery("MATCH(i:Issue{id:'issue'}) OPTIONAL MATCH(i)-[:ACTIVITY_ON_ISSUE]->(action:ModerationAction) RETURN i.issueNumber AS number,count(action) AS actions");
  assert.equal(persisted.records[0].get('number'),'7');assert.equal(persisted.records[0].get('actions').toNumber(),1);
  const replay=await repository.findExistingReport({id:{eq:'issue'}});assert.equal(replay[0].issueNumber,7);
 }finally{await stopNeo4j();}
});
