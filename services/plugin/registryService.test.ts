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

const installFetchMock = (registries: Record<string, any>) => {
  globalThis.fetch = (async (url: any) => {
    const key = String(url)
    if (!(key in registries)) {
      throw new Error(`Unexpected fetch: ${key}`)
    }

    const response = registries[key]
    const ok = response.ok ?? true
    const status = response.status ?? 200
    const statusText = response.statusText ?? 'OK'
    const jsonValue = response.json ?? response

    return {
      ok,
      status,
      statusText,
      json: async () => {
        if (response.json !== undefined) return response.json
        if (response.text !== undefined) return JSON.parse(response.text)
        return response
      },
      text: async () => {
        if (response.text !== undefined) return response.text
        return JSON.stringify(jsonValue)
      }
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

test('fetchMergedPluginRegistry can synthesize a registry from a GitHub repo release feed', async () => {
  installFetchMock({
    'https://api.github.com/repos/gennit-project/multiforum-plugin-hello-world/releases?per_page=100': {
      json: [
        {
          tag_name: 'v0.2.2',
          html_url: 'https://github.com/gennit-project/multiforum-plugin-hello-world/releases/tag/v0.2.2',
          target_commitish: 'main',
          assets: [
            {
              name: 'plugin.json',
              browser_download_url: 'https://github.com/gennit-project/multiforum-plugin-hello-world/releases/download/v0.2.2/plugin.json'
            },
            {
              name: 'hello-world-0.2.2.tgz',
              browser_download_url: 'https://github.com/gennit-project/multiforum-plugin-hello-world/releases/download/v0.2.2/hello-world-0.2.2.tgz'
            },
            {
              name: 'hello-world-0.2.2.tgz.sha256',
              browser_download_url: 'https://github.com/gennit-project/multiforum-plugin-hello-world/releases/download/v0.2.2/hello-world-0.2.2.tgz.sha256'
            }
          ]
        }
      ]
    },
    'https://github.com/gennit-project/multiforum-plugin-hello-world/releases/download/v0.2.2/plugin.json': {
      json: {
        id: 'hello-world',
        version: '0.2.2',
        source: {
          repoUrl: 'https://github.com/gennit-project/multiforum-plugin-hello-world'
        },
        compatibility: {
          minServerVersion: '1.0.0',
          apiVersion: '1'
        }
      }
    },
    'https://github.com/gennit-project/multiforum-plugin-hello-world/releases/download/v0.2.2/hello-world-0.2.2.tgz.sha256': {
      text: 'abc123  hello-world-0.2.2.tgz\n'
    }
  })

  const registry = await fetchMergedPluginRegistry([
    'https://github.com/gennit-project/multiforum-plugin-hello-world'
  ])

  assert.deepEqual(registry.plugins.map((plugin) => plugin.id), ['hello-world'])
  const version = registry.plugins[0]?.versions[0]
  assert.equal(version?.version, '0.2.2')
  assert.equal(version?.tarballUrl, 'https://github.com/gennit-project/multiforum-plugin-hello-world/releases/download/v0.2.2/hello-world-0.2.2.tgz')
  assert.equal(version?.integritySha256, 'abc123')
  assert.equal(version?.releaseNotesUrl, 'https://github.com/gennit-project/multiforum-plugin-hello-world/releases/tag/v0.2.2')
  assert.equal(version?.sourceRepoUrl, 'https://github.com/gennit-project/multiforum-plugin-hello-world')
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
