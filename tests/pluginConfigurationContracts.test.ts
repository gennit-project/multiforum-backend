import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { getOperationAST, getVariableValues, parse, validate, type GraphQLSchema } from 'graphql';
import type { Driver } from 'neo4j-driver';
import { buildPublicSchema } from '../build_scripts/publicSchema.js';
import { createPluginConfigurationWriteRepository } from '../services/persistence/pluginConfigurationWriteRepository.js';
import { productionManifest, runFixtureCli, type Operation } from './helpers/pluginConfigurationFixture.js';

let schema: GraphQLSchema;
before(async () => { schema = await buildPublicSchema(); });
const errors = ({ query, variables }: Operation) => {
  const document = parse(query);
  const operation = getOperationAST(document);
  assert.ok(operation);
  return [
    ...validate(schema, document),
    ...(getVariableValues(schema, operation.variableDefinitions ?? [], variables).errors ?? []),
  ].map(error => error.message);
};

async function repositoryOperations(): Promise<Operation[]> {
  const operations: Operation[] = [];
  const repository = createPluginConfigurationWriteRepository({} as Driver, async (_driver, query, variables) => {
    operations.push({ query, variables });
  });
  await repository.setRegistries(['https://registry.example.test/index.json']);
  await repository.setRegistries([]);
  for (const settingsJson of [undefined, {}, { threshold: 0.8, nested: { enabled: true } }]) {
    await repository.configureChannelPlugin({ channelUniqueName: 'trial', pluginId: 'llm-moderation', version: '0.7.1', enabled: true, settingsJson });
  }
  await repository.configureChannelPlugin({ channelUniqueName: 'trial', pluginId: 'llm-moderation', version: '0.7.1', enabled: false });
  return operations;
}

test('production repository documents AND representative variables validate offline', async () => {
  const operations = await repositoryOperations();
  assert.deepEqual([...new Set(operations.map(operation => getOperationAST(parse(operation.query))?.name?.value))],
    ['SetPluginConfigurationRegistries', 'ConfigureChannelPlugin']);
  for (const operation of operations) assert.deepEqual(errors(operation), [], operation.query);
});

test('actual mfctl plan/apply documents accept the rendered production template and secret resolutions', async () => {
  const manifest = await productionManifest();
  const names: string[] = [];
  for (const action of ['plan', 'apply'] as const) {
    const result = await runFixtureCli(action, manifest, async operation => {
      assert.deepEqual(errors(operation), []);
      names.push(getOperationAST(parse(operation.query))!.name!.value);
      if (action === 'apply') assert.equal((operation.variables.secretResolutions as unknown[]).length, 2);
      return { data: action === 'plan'
        ? { previewPluginConfigurationReconciliation: { inSync: true } }
        : { applyPluginConfiguration: { status: 'NO_CHANGES', planAfter: { inSync: true } } } };
    });
    assert.equal(result.code, 0);
  }
  assert.deepEqual(names, ['MfctlPreview', 'MfctlApply']);
});

test('regressions reject top-level connect, raw filters and raw list updates independently', async () => {
  const [registry, , channel] = await repositoryOperations();
  assert.match(errors({ ...channel, query: channel.query.replace('update: $update)', 'update: $update, connect: {})') }).join('\n'), /Unknown argument "connect"/);
  assert.match(errors({ ...channel, variables: { ...channel.variables, where: { uniqueName: 'trial' } } }).join('\n'), /StringScalarFilters/);
  assert.match(errors({ ...channel, variables: { ...channel.variables, update: { EnabledPlugins: [{ connect: [{ where: { node: { Plugin: { name: 'llm-moderation' }, version: '0.7.1' } } }] }] } } }).join('\n'), /StringScalarFilters/);
  assert.match(errors({ ...registry, variables: { ...registry.variables, update: { pluginRegistries: ['https://registry.example.test'] } } }).join('\n'), /pluginRegistries/);
});
