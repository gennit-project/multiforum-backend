import 'dotenv/config'
import neo4j from 'neo4j-driver'
import { createOgmAndModels } from '../customResolvers/resolverDeps.js'
import { materializeLegacyDownloadPipelines } from '../services/plugin/legacyPipelineMigration.js'
import type { PluginEdgeData } from '../services/plugin/types.js'

const uri = process.env.NEO4J_URI || 'bolt://localhost:7687'
const user = process.env.NEO4J_USER || 'neo4j'
const password = process.env.NEO4J_PASSWORD

if (!password) {
  throw new Error('NEO4J_PASSWORD is required to migrate plugin pipelines')
}

const run = async () => {
  const driver = neo4j.driver(uri, neo4j.auth.basic(user, password))
  const deps = createOgmAndModels(driver)
  await deps.ogm.init()

  try {
    const configs = await deps.ServerConfig.find({
      selectionSet: `{
        serverName
        pluginPipelines
        InstalledVersionsConnection {
          edges {
            properties { enabled settingsJson }
            node {
              id version repoUrl tarballGsUri entryPath manifest
              settingsDefaults uiSchema
              Plugin { id name displayName description metadata }
            }
          }
        }
      }`,
    })

    for (const config of configs) {
      const result = materializeLegacyDownloadPipelines({
        storedPipelines: config.pluginPipelines,
        installedPluginEdges: (
          config.InstalledVersionsConnection?.edges || []
        ) as unknown as PluginEdgeData[],
      })
      if (result.addedEvents.length === 0) continue

      await deps.ServerConfig.update({
        where: { serverName: config.serverName },
        update: { pluginPipelines: JSON.stringify(result.pipelines) },
      })
      console.log(
        `[pipeline-migration] ${config.serverName}: added ${result.addedEvents.join(', ')}`
      )
    }
  } finally {
    await driver.close()
  }
}

run().catch(error => {
  console.error('Plugin pipeline migration failed', error)
  process.exitCode = 1
})
