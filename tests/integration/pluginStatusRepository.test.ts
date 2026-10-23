import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import type { Driver } from "neo4j-driver";
import getCustomResolvers from "../helpers/getTestResolvers.js";
import typeDefs from "../../typeDefs.js";
import type { GraphQLContext } from "../../types/context.js";
import { registerGeneratedSchema } from "../../services/persistence/generatedSchemaOperations.js";
import { createPluginStatusRepository } from "../../services/persistence/pluginStatusRepository.js";
import getPluginConfigStatus from "../../customResolvers/queries/getPluginConfigStatus.js";
import type { GraphQLResolveInfo } from "graphql";

import { resetDatabase, startNeo4j, stopNeo4j } from "./neo4jHarness.js";

let driver: Driver;
let app: ReturnType<typeof getCustomResolvers>;
before(async () => {
  driver = await startNeo4j();
  app = getCustomResolvers(driver);
  const neoSchema = new Neo4jGraphQL({
    typeDefs, driver, resolvers: app.resolvers,
    features: { filters: { String: { MATCHES: true } }, subscriptions: true },
  });
  const schema = await neoSchema.getSchema();
  registerGeneratedSchema(driver, schema);
}, { timeout: 240_000 });
beforeEach(async () => resetDatabase(driver));
after(async () => stopNeo4j());
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

const seed = async (version = '1.0.0', id = 'version-id', name = 'scanner') => {
  await driver.executeQuery(`CREATE (p:Plugin {id:'plugin-id',name:$name})-[:HAS_VERSION]->(v:PluginVersion {id:$id,version:$version,manifest:'{}'})
    CREATE (:ServerConfig {serverName:'first'})-[:INSTALLED {settingsJson:'{}'}]->(v)
    CREATE (:ServerSecret {pluginId:$name,key:'token',ciphertext:'synthetic-only',isValid:true,lastValidatedAt:datetime('2026-01-01T00:00:00Z')})`, {version,id,name});
};
const graph = async () => plain((await driver.executeQuery('MATCH (n) RETURN labels(n) AS labels, properties(n) AS properties ORDER BY labels')).records.map(r=>r.toObject()));

test('ordinary values preserve all three legacy projections and resolver result without exposing ciphertext', async (t) => {
  await seed(); const repo=createPluginStatusRepository(driver); const before=await graph();
  t.assert.snapshot(plain(await repo.findVersion('scanner','1.0.0')));
  t.assert.snapshot(plain(await repo.findInstallation('version-id')));
  const secrets=await repo.findSecretStatuses('scanner');
  t.assert.snapshot(plain(secrets));
  assert.ok(!JSON.stringify(secrets).includes('synthetic-only'));
  const result=await getPluginConfigStatus({driver})(null,{pluginId:'scanner',version:'1.0.0'},{} as GraphQLContext,{} as GraphQLResolveInfo);
  assert.deepEqual(result,{isFullyConfigured:true,fields:[]}); assert.deepEqual(await graph(),before);
});
for(const value of ['quoted"value', String.raw`literal\u0031`, 'x" }) { id } extra: Versions { id } #']) {
  test(`approved literal version and stored ID handling: ${JSON.stringify(value)}`,async()=>{
    await seed(value,value); const repo=createPluginStatusRepository(driver); const before=await graph();
    assert.deepEqual(plain(await repo.findVersion('scanner',value)),[{Versions:[{id:value,manifest:'{}'}]}]);
    assert.deepEqual(plain(await repo.findInstallation(value)),[{InstalledVersionsConnection:{edges:[{properties:{settingsJson:'{}'}}]}}]);
    assert.deepEqual(await getPluginConfigStatus({driver})(null,{pluginId:'scanner',version:value},{} as GraphQLContext,{} as GraphQLResolveInfo),{isFullyConfigured:true,fields:[]});
    assert.deepEqual(await graph(),before);
  });
}
test('plugin names remain literal, missing version and absent installation retain prefixed errors',async(t)=>{
  const name='plugin"\\name'; await seed('1','id',name); const repo=createPluginStatusRepository(driver);
  t.assert.snapshot(plain(await repo.findVersion(name,'1')));
  const resolver=getPluginConfigStatus({driver});
  await assert.rejects(resolver(null,{pluginId:name,version:'missing'},{} as GraphQLContext,{} as GraphQLResolveInfo),/Failed to get plugin config status: Plugin .* not found/);
  await driver.executeQuery('MATCH ()-[r:INSTALLED]->() DELETE r');
  await assert.rejects(resolver(null,{pluginId:name,version:'1'},{} as GraphQLContext,{} as GraphQLResolveInfo),/Failed to get plugin config status: Plugin .* is not installed/);
});
test('unbounded and nested limits remain equal to legacy projections',async(t)=>{
  await seed(); await driver.executeQuery(`UNWIND range(1,30) AS i CREATE (p:Plugin {id:'p'+toString(i),name:'scanner'})-[:HAS_VERSION]->(:PluginVersion {id:'v'+toString(i),version:'1.0.0',manifest:'{}'})`);
  t.assert.snapshot(plain(await createPluginStatusRepository(driver).findVersion('scanner','1.0.0')));
  await driver.executeQuery(`MATCH (p:Plugin {id:'plugin-id'}) UNWIND range(1,30) AS i CREATE (p)-[:HAS_VERSION]->(:PluginVersion {id:'nested'+toString(i),version:'1.0.0',manifest:'{}'})`);
  const current=await createPluginStatusRepository(driver).findVersion('scanner','1.0.0');
  t.assert.snapshot(plain(current));
  assert.ok(current.some(plugin=>(plugin.Versions?.length ?? 0)>1));
});
