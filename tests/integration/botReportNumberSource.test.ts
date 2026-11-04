import assert from 'node:assert/strict';
import test from 'node:test';
import {Neo4jGraphQL} from '@neo4j/graphql';
import typeDefs from '../../typeDefs.js';
import getResolvers from '../helpers/getTestResolvers.js';
import {registerGeneratedSchema} from '../../services/persistence/generatedSchemaOperations.js';
import {createBotReportRepository} from '../../services/persistence/botReportRepository.js';
import {createBotReport} from '../../services/botReportService.js';
import {startNeo4j,stopNeo4j} from './neo4jHarness.js';
// Failure witness, not desired API behavior: replace once the response policy is chosen.
test('known deferred bot report number source differs from GraphQL scalar completion',async()=>{
 const driver=await startNeo4j();
 try{
  registerGeneratedSchema(driver,await new Neo4jGraphQL({driver,typeDefs,resolvers:getResolvers(driver).resolvers}).getSchema());
  await driver.executeQuery("CREATE(:Channel{uniqueName:'forum',createdAt:datetime()}) CREATE(:Issue{id:'issue',issueNumber:'7',channelUniqueName:'forum',relatedCommentId:'content',isOpen:true,flaggedServerRuleViolation:false,createdAt:datetime()})");
  const repository=createBotReportRepository(driver);
  const read=await repository.findExistingReport({id:{eq:'issue'}});assert.equal(read[0].issueNumber,7);
  const result=await createBotReport({driver,channelUniqueName:'forum',reportInput:{contentType:'comment',contentId:'content',reportText:'Review',selectedForumRules:['rule'],selectedServerRules:[],botName:'helper'}});
  assert.ok(result);assert.equal(result.issueId,'issue');assert.equal(result.issueNumber,'7');
  const replay=await repository.findExistingReport({id:{eq:'issue'}});assert.equal(replay[0].issueNumber,7);
 }finally{await stopNeo4j();}
});
