import assert from 'node:assert/strict'
import test, { afterEach } from 'node:test'
import {
  compareVersions,
  fetchMergedPluginRegistry,
  findLatestVersion,
  sortVersionsDescending
} from './registryService.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

const installFetchMock = (registries: Record<string, unknown>) => {
  globalThis.fetch = (async (url: any) => {
    const key = String(url)
    if (!(key in registries)) {
      throw new Error(`Unexpected fetch: ${key}`)
    }

    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => registries[key]
    }
  }) as any
}

test('fetchMergedPluginRegistry merges multiple registry URLs and sorts versions', async () => {
  installFetchMock({
    'https://registry-a.test/registry.json': {
      plugins: [
        {
          id: 'alpha',
          versions: [
            {
              version: '1.0.0',
              tarballUrl: 'https://registry-a.test/alpha-1.0.0.tgz',
              integritySha256: 'aaa'
            }
          ]
        }
      ]
    },
    'https://registry-b.test/registry.json': {
      plugins: [
        {
          id: 'alpha',
          versions: [
            {
              version: '1.1.0',
              tarballUrl: 'https://registry-b.test/alpha-1.1.0.tgz',
              integritySha256: 'bbb',
              releaseNotesUrl: 'https://registry-b.test/alpha/releases/1.1.0',
              sourceRepoUrl: 'https://github.com/example/alpha',
              sourceCommit: 'abcdef123456',
              minServerVersion: '0.8.0',
              apiVersion: '1'
            }
          ]
        },
        {
          id: 'beta',
          versions: [
            {
              version: '0.1.0',
              tarballUrl: 'https://registry-b.test/beta-0.1.0.tgz',
              integritySha256: 'ccc'
            }
          ]
        }
      ]
    }
  })

  const registry = await fetchMergedPluginRegistry([
    'https://registry-a.test/registry.json',
    'https://registry-b.test/registry.json'
  ])

  assert.deepEqual(
    registry.plugins.map((plugin) => plugin.id),
    ['alpha', 'beta']
  )
  assert.deepEqual(
    registry.plugins.find((plugin) => plugin.id === 'alpha')?.versions.map((version) => version.version),
    ['1.1.0', '1.0.0']
  )
  const latestAlpha = registry.plugins.find((plugin) => plugin.id === 'alpha')?.versions[0]
  assert.equal(latestAlpha?.registryUrl, 'https://registry-b.test/registry.json')
  assert.equal(latestAlpha?.releaseNotesUrl, 'https://registry-b.test/alpha/releases/1.1.0')
  assert.equal(latestAlpha?.sourceRepoUrl, 'https://github.com/example/alpha')
  assert.equal(latestAlpha?.sourceCommit, 'abcdef123456')
  assert.equal(latestAlpha?.minServerVersion, '0.8.0')
  assert.equal(latestAlpha?.apiVersion, '1')
})

test('fetchMergedPluginRegistry rejects conflicting plugin version entries', async () => {
  installFetchMock({
    'https://registry-a.test/registry.json': {
      plugins: [
        {
          id: 'alpha',
          versions: [
            {
              version: '1.0.0',
              tarballUrl: 'https://registry-a.test/alpha-1.0.0.tgz',
              integritySha256: 'aaa'
            }
          ]
        }
      ]
    },
    'https://registry-b.test/registry.json': {
      plugins: [
        {
          id: 'alpha',
          versions: [
            {
              version: '1.0.0',
              tarballUrl: 'https://registry-b.test/alpha-1.0.0.tgz',
              integritySha256: 'bbb'
            }
          ]
        }
      ]
    }
  })

  await assert.rejects(
    fetchMergedPluginRegistry([
      'https://registry-a.test/registry.json',
      'https://registry-b.test/registry.json'
    ]),
    /Conflicting registry entry for alpha@1\.0\.0/
  )
})

test('version helpers sort releases ahead of prereleases', () => {
  assert.equal(compareVersions('1.0.0', '1.0.0-beta.1') > 0, true)
  assert.equal(findLatestVersion(['v1.0.0', '1.1.0-beta.1', '1.0.1']), '1.1.0-beta.1')
  assert.deepEqual(
    sortVersionsDescending([
      { version: '0.2.0' },
      { version: '0.10.0' },
      { version: '0.10.0-beta.1' }
    ]).map((version) => version.version),
    ['0.10.0', '0.10.0-beta.1', '0.2.0']
  )
})
