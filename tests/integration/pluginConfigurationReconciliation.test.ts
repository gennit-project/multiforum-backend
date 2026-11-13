import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import { Neo4jGraphQL } from '@neo4j/graphql';
import { graphql, type GraphQLSchema } from 'graphql';
import { applyMiddleware } from 'graphql-middleware';
import type { Driver } from 'neo4j-driver';
import typeDefs from '../../typeDefs.js';
import permissions from '../../permissions.js';
import getCustomResolvers from '../helpers/getTestResolvers.js';
import installPluginVersion from '../../customResolvers/mutations/installPluginVersion.js';
import { buildDefaultOperations, createApplyPluginConfigurationResolver } from '../../customResolvers/mutations/applyPluginConfiguration.js';
import { registerGeneratedSchema } from '../../services/persistence/generatedSchemaOperations.js';
import { createPluginConfigurationWriteRepository } from '../../services/persistence/pluginConfigurationWriteRepository.js';
import { createPluginConfigurationReadRepository } from '../../services/persistence/pluginConfigurationReadRepository.js';
import { productionManifest, runFixtureCli, type Operation } from '../helpers/pluginConfigurationFixture.js';
import { resetDatabase, startNeo4j, stopNeo4j } from './neo4jHarness.js';
import type { PluginConfigurationDesiredStateInput } from '../../src/generated/graphql.js';
import { decryptSecret } from '../../services/plugin/encryption.js';

let driver: Driver;
let schema: GraphQLSchema;
let manifest: PluginConfigurationDesiredStateInput;
let downloads: string[] = [];
let installFailure: Error | null = null;
const registry = 'https://registry.example.test/index.json';
const originalEncryptionKey = process.env.PLUGIN_SECRET_ENCRYPTION_KEY;

before(async () => {
  process.env.PLUGIN_SECRET_ENCRYPTION_KEY = 'fixture-only-encryption-key-00000';
  driver = await startNeo4j();
  manifest = await productionManifest();
  const { resolvers } = getCustomResolvers(driver);
  // Only external artifact IO is faked. Install uses real integrity checks,
  // resolver logic, generated GraphQL operations and database repositories.
  const install = installPluginVersion({ driver }, {
    fetchRegistry: async urls => {
      assert.deepEqual(urls, [registry]);
      return { plugins: manifest.plugins.map(plugin => ({
        id: plugin.pluginId,
        versions: [{ version: plugin.version, tarballUrl: `https://registry.example.test/${plugin.pluginId}`,
          integritySha256: createHash('sha256').update(plugin.pluginId).digest('hex') }],
      })) };
    },
    download: async url => {
      downloads.push(url);
      const plugin = manifest.plugins.find(plugin => url === `https://registry.example.test/${plugin.pluginId}`);
      assert.ok(plugin, `Unexpected artifact ${url}`);
      return Buffer.from(plugin.pluginId);
    },
    readManifest: async bytes => {
      const plugin = manifest.plugins.find(plugin => plugin.pluginId === bytes.toString());
      assert.ok(plugin);
      return { id: plugin.pluginId, version: plugin.version, entryPath: 'index.js',
        manifest: { id: plugin.pluginId, version: plugin.version, name: plugin.pluginId } };
    },
  });
  resolvers.Mutation.applyPluginConfiguration = createApplyPluginConfigurationResolver({}, parameters => ({
    ...buildDefaultOperations(parameters),
    install: args => {
      if (installFailure) throw installFailure;
      return install({}, args, parameters.context, parameters.info);
    },
  }));
  const generated = await new Neo4jGraphQL({ typeDefs, driver, resolvers,
    features: { filters: { String: { MATCHES: true } }, subscriptions: true },
  }).getSchema();
  registerGeneratedSchema(driver, generated);
  schema = applyMiddleware(generated, permissions);
}, { timeout: 240_000 });
beforeEach(async () => {
  await resetDatabase(driver);
  downloads = [];
  installFailure = null;
  await driver.executeQuery("CREATE (:ServerConfig {serverName: 'fixture', pluginRegistries: [], pluginPipelines: '[]'}) CREATE (:Channel {uniqueName: 'trial'}) CREATE (:Channel {uniqueName: 'other'})");
});
after(async () => {
  await stopNeo4j();
  if (originalEncryptionKey === undefined) delete process.env.PLUGIN_SECRET_ENCRYPTION_KEY;
  else process.env.PLUGIN_SECRET_ENCRYPTION_KEY = originalEncryptionKey;
});

const execute = ({ query, variables }: Operation) => graphql({ schema, source: query, variableValues: variables,
  // Authenticated automation context; real permission middleware stays installed.
  contextValue: { driver, pluginConfigurationAutomation: { subject: 'fixture' } },
});

async function channelEdges() {
  return (await driver.executeQuery(`MATCH (c:Channel)-[e:ENABLED]->(v:PluginVersion)<-[:HAS_VERSION]-(p:Plugin)
    RETURN c.uniqueName AS channel, p.name AS plugin, v.version AS version, e.enabled AS enabled, e.settingsJson AS settings`)).records.map(record => record.toObject());
}

test('production template plans, applies real writes, reads back and converges on rerun', async () => {
  const desired = { ...manifest, registries: { urls: [registry] } };
  const plan = await runFixtureCli('plan', desired, execute);
  assert.equal(plan.code, 2);
  assert.equal(plan.output.inSync, false);
  assert.ok(plan.output.changes.some((change: { kind: string }) => change.kind === 'INSTALL_VERSION'));
  assert.ok(plan.output.changes.some((change: { kind: string }) => change.kind === 'ENABLE_CHANNEL_PLUGIN'));
  assert.equal(downloads.length, 0, 'plan must not install');
  assert.equal((await driver.executeQuery('MATCH (p:Plugin) RETURN p')).records.length, 0);

  const applied = await runFixtureCli('apply', desired, execute);
  assert.equal(applied.code, 0, JSON.stringify(applied.output));
  assert.equal(applied.output.status, 'SUCCEEDED');
  assert.equal(applied.output.planAfter.inSync, true);
  assert.ok(applied.output.operations.every((operation: { status: string }) => operation.status === 'APPLIED'));
  assert.equal(downloads.length, manifest.plugins.length);
  const reads = createPluginConfigurationReadRepository(driver);
  const configs = await reads.listReconciliationConfigs();
  assert.deepEqual(configs[0].pluginRegistries, [registry]);
  const storedPipelines = JSON.parse(String(configs[0].pluginPipelines)) as Array<Record<string, unknown>>;
  assert.deepEqual(storedPipelines.map(({ effectiveAt, policyId, ...pipeline }) => {
    if (pipeline.applicability) {
      assert.equal(typeof effectiveAt, 'string');
      assert.equal(typeof policyId, 'string');
    }
    return pipeline;
  }), manifest.pipelines);
  const installed = (await driver.executeQuery(`MATCH (:ServerConfig)-[e:INSTALLED]->(v:PluginVersion)<-[:HAS_VERSION]-(p:Plugin)
    RETURN p.name AS plugin, v.version AS version, e.enabled AS enabled, e.settingsJson AS settings`)).records.map(record => record.toObject());
  assert.equal(installed.length, manifest.plugins.length);
  for (const plugin of manifest.plugins) {
    const actual = installed.find(row => row.plugin === plugin.pluginId);
    assert.ok(actual);
    assert.equal(actual.version, plugin.version);
    assert.equal(actual.enabled, true);
    assert.deepEqual(JSON.parse(actual.settings), plugin.settingsJson);
  }
  assert.ok(reads.listReconciliationChannels);
  assert.equal((await reads.listReconciliationChannels(['trial']))[0].uniqueName, 'trial');
  assert.deepEqual(await channelEdges(), [{ channel: 'trial', plugin: 'llm-moderation', version: '0.8.0', enabled: true, settings: null }]);
  const secretRows = await driver.executeQuery('MATCH (s:ServerSecret) RETURN s.key AS key, s.ciphertext AS ciphertext');
  assert.equal(secretRows.records.length, 2);
  for (const row of secretRows.records) {
    assert.equal(decryptSecret(row.get('ciphertext')), row.get('key') === 'SCAN_SERVICE_API_KEY' ? 'fixture-scan-secret' : 'fixture-moderation-secret');
  }
  const after = await runFixtureCli('plan', desired, execute);
  assert.equal(after.code, 0);
  assert.deepEqual(after.output.changes, []);
  // mfctl intentionally refreshes supplied secrets on every apply. Verify no
  // configuration operations repeat and no duplicate installations are created.
  const again = await runFixtureCli('apply', desired, execute);
  assert.equal(again.code, 0, JSON.stringify(again.output));
  assert.ok(again.output.operations.every((operation: { kind: string }) => operation.kind === 'REPLACE_SECRET'));
  assert.equal(downloads.length, manifest.plugins.length);
  assert.deepEqual(JSON.parse(String((await reads.listReconciliationConfigs())[0].pluginPipelines)), storedPipelines);
  assert.equal((await channelEdges()).length, 1);
  assert.equal((await driver.executeQuery('MATCH ()-[e:INSTALLED]->() RETURN e')).records.length, manifest.plugins.length);
  const noSecrets = { ...desired, plugins: desired.plugins.map(({ secretRefs: _refs, ...plugin }) => plugin) };
  const noop = await runFixtureCli('apply', noSecrets, execute);
  assert.equal(noop.output.status, 'NO_CHANGES');
  assert.deepEqual(noop.output.operations, []);
});

test('channel enable, settings update and disable target only the requested version and channel', async () => {
  await driver.executeQuery(`CREATE (p:Plugin {id:'p', name:'scanner'})
    CREATE (p)-[:HAS_VERSION]->(:PluginVersion {id:'v1', version:'1', repoUrl:'https://example.test/1', entryPath:'index.js'})
    CREATE (p)-[:HAS_VERSION]->(:PluginVersion {id:'v2', version:'2', repoUrl:'https://example.test/2', entryPath:'index.js'})`);
  const writes = createPluginConfigurationWriteRepository(driver);
  const input = { channelUniqueName: 'trial', pluginId: 'scanner', version: '1', enabled: true };
  await writes.configureChannelPlugin({ ...input, settingsJson: { threshold: 0.8 } });
  await writes.configureChannelPlugin({ ...input, version: '2' });
  await writes.configureChannelPlugin({ ...input, channelUniqueName: 'other' });
  await writes.configureChannelPlugin({ ...input, settingsJson: { threshold: 0.9 } });
  await writes.configureChannelPlugin(input); // Omitted settings preserve the stored value.
  let edges = await channelEdges();
  assert.equal(edges.length, 3);
  assert.deepEqual(edges.find(edge => edge.channel === 'trial' && edge.version === '1'), {
    channel: 'trial', plugin: 'scanner', version: '1', enabled: true, settings: '{"threshold":0.9}',
  });
  await writes.configureChannelPlugin({ ...input, enabled: false });
  await writes.configureChannelPlugin({ ...input, enabled: false });
  edges = await channelEdges();
  assert.equal(edges.length, 2);
  assert.ok(edges.every(edge => edge.channel !== 'trial' || edge.version !== '1'));
  await writes.setRegistries([registry]);
  await writes.setRegistries([]);
  assert.deepEqual((await createPluginConfigurationReadRepository(driver).listReconciliationConfigs())[0].pluginRegistries, []);
});


const planFields = `apiVersion inSync warnings changes { kind path message current desired blocked }`;
const applyFields = `status message operations { kind path status message } planBefore { ${planFields} } planAfter { ${planFields} }`;
const previewOperation = (desired: PluginConfigurationDesiredStateInput): Operation => ({
  query: `query($manifest:PluginConfigurationDesiredStateInput!){result:previewPluginConfigurationReconciliation(manifest:$manifest){${planFields}}}`,
  variables: {manifest:desired},
});
const applyOperation = (desired: PluginConfigurationDesiredStateInput, secretResolutions: {valueFrom:string;value:string}[]=[]): Operation => ({
  query: `mutation($manifest:PluginConfigurationDesiredStateInput!,$secrets:[PluginSecretResolutionInput!]){result:applyPluginConfiguration(manifest:$manifest,secretResolutions:$secrets){${applyFields}}}`,
  variables:{manifest:desired,secrets:secretResolutions},
});
const emptyDesired: PluginConfigurationDesiredStateInput = {apiVersion:'multiforum.gennit.dev/v1alpha1',plugins:[]};
const response = (result:Awaited<ReturnType<typeof execute>>) => {
  assert.equal(result.errors,undefined,JSON.stringify(result.errors));
  return JSON.parse(JSON.stringify(result.data)).result;
};
test('generated recursive response serializes empty and nullable live configuration without writes',async()=>{
  await driver.executeQuery('MATCH(s:ServerConfig) REMOVE s.pluginRegistries,s.pluginPipelines');
  const plan=response(await execute(previewOperation(emptyDesired)));
  assert.deepEqual(plan,{apiVersion:emptyDesired.apiVersion,inSync:true,warnings:['Plugin registries are unmanaged because registries was omitted','Channel plugins are unmanaged because channelPlugins was omitted','Server pipelines are unmanaged because pipelines was omitted'],changes:[]});
  const applied=response(await execute(applyOperation(emptyDesired)));
  assert.deepEqual(applied,{status:'NO_CHANGES',message:'Plugin configuration is already in sync',operations:[],planBefore:plan,planAfter:plan});
  assert.equal(downloads.length,0);
});
test('nullable Plugin relationship is omitted from live reconciliation rather than fabricated',async()=>{
  await driver.executeQuery("MATCH(s:ServerConfig) CREATE(s)-[:INSTALLED {enabled:true}]->(:PluginVersion {version:'1'})");
  const repository=createPluginConfigurationReadRepository(driver);
  const edge=(await repository.listReconciliationConfigs())[0].InstalledVersionsConnection.edges[0];
  assert.deepEqual(JSON.parse(JSON.stringify(edge)),{properties:{enabled:true,settingsJson:null},node:{version:'1',Plugin:null}});
  assert.equal(response(await execute(previewOperation(emptyDesired))).inSync,true);
});
test('blocked response preserves nested changes and leaves the graph untouched',async()=>{
  const desired:PluginConfigurationDesiredStateInput={...emptyDesired,plugins:[{pluginId:'fixture',version:'1',enabled:true,requiredSecrets:['API_KEY']}]};
  const applied=response(await execute(applyOperation(desired)));
  assert.equal(applied.status,'BLOCKED');assert.equal(applied.planBefore.inSync,false);
  assert.deepEqual(applied.planAfter,applied.planBefore);
  assert.ok(applied.operations.some((item:{status:string;kind:string})=>item.status==='BLOCKED'&&item.kind==='SET_SECRET'));
  assert.equal(downloads.length,0);
  assert.equal((await driver.executeQuery('MATCH(p:Plugin) RETURN count(p) AS count')).records[0].get('count').toNumber(),0);
});
test('partial failure serializes APPLIED then FAILED and redacts secret values while preserving prior writes',async()=>{
  const secret='disposable-response-contract-secret';
  installFailure=new Error(`fixture install failed ${secret}`);
  const desired:PluginConfigurationDesiredStateInput={...emptyDesired,registries:{urls:[registry]},plugins:[{pluginId:'fixture',version:'1',enabled:true,secretRefs:[{key:'API_KEY',valueFrom:'env:FIXTURE'}]}]};
  const applied=response(await execute(applyOperation(desired,[{valueFrom:'env:FIXTURE',value:secret}])));
  assert.equal(applied.status,'FAILED');
  assert.deepEqual(applied.operations.map((item:{status:string})=>item.status),['APPLIED','FAILED']);
  assert.match(applied.operations[1].message,/\[REDACTED\]/);
  assert.ok(!JSON.stringify(applied).includes(secret));
  assert.deepEqual((await createPluginConfigurationReadRepository(driver).listReconciliationConfigs())[0].pluginRegistries,[registry]);
  assert.equal(applied.planAfter.inSync,false);assert.equal(downloads.length,0);
});
test('permission middleware denies anonymous preview and apply before writes',async()=>{
  for(const operation of [previewOperation(emptyDesired),applyOperation({...emptyDesired,registries:{urls:[registry]}})]) {
    const result=await graphql({schema,source:operation.query,variableValues:operation.variables,contextValue:{driver,req:{headers:{}}}});
    assert.ok(result.errors);
  }
  assert.deepEqual((await createPluginConfigurationReadRepository(driver).listReconciliationConfigs())[0].pluginRegistries,[]);
});
test('malformed selected live configuration fields retain errors before applying changes',async()=>{
  await driver.executeQuery("MATCH(s:ServerConfig) CREATE (s)-[:INSTALLED]->(:PluginVersion {version:'1'})");
  for(const operation of [previewOperation(emptyDesired),applyOperation(emptyDesired)]) {
    const result=await execute(operation);
    assert.equal(result.data,null);
    assert.ok(result.errors?.some(error=>error.message.includes('enabled')));
  }
  assert.equal(downloads.length,0);
});
