import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runPluginConfigurationCli } from '../../build_scripts/pluginConfigurationCli.js';
import { renderProductionPluginConfiguration } from '../../build_scripts/renderProductionPluginConfiguration.js';
import type { PluginConfigurationDesiredStateInput } from '../../src/generated/graphql.js';

export async function productionManifest(): Promise<PluginConfigurationDesiredStateInput> {
  const template = JSON.parse(await readFile(new URL('../../deployment/plugin-configuration/production.template.json', import.meta.url), 'utf8'));
  return renderProductionPluginConfiguration(template, {
    scanServiceUrl: 'https://scan.example.test',
    moderationServiceUrl: 'https://moderation.example.test',
    trialForum: 'trial',
  }) as PluginConfigurationDesiredStateInput;
}

export type Operation = { query: string; variables: Record<string, unknown> };

// Use the actual CLI serializer and documents, with no HTTP or ambient credentials.
export async function runFixtureCli(
  action: 'plan' | 'apply',
  manifest: PluginConfigurationDesiredStateInput,
  execute: (operation: Operation) => Promise<unknown>,
) {
  let stdout = '';
  let stderr = '';
  const code = await runPluginConfigurationCli(['plugin-config', action, '--manifest', 'fixture.json', '--json'], {
    env: {
      MULTIFORUM_GRAPHQL_URL: 'https://backend.example.test/graphql',
      MULTIFORUM_ACCESS_TOKEN: 'fixture-token',
      SCAN_API_KEY: 'fixture-scan-secret',
      MOD_API_KEY: 'fixture-moderation-secret',
    },
    readFile: async () => JSON.stringify(manifest),
    fetch: async (url, init) => {
      assert.equal(url, 'https://backend.example.test/graphql');
      return Response.json(await execute(JSON.parse(String(init?.body)) as Operation));
    },
    stdout: { write: chunk => { stdout += String(chunk); return true; } },
    stderr: { write: chunk => { stderr += String(chunk); return true; } },
  });
  assert.equal(stderr, '', stderr);
  return { code, output: JSON.parse(stdout) };
}
