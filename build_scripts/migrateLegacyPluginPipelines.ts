import 'dotenv/config'
import neo4j from 'neo4j-driver'
import { initializeLegacyPipelineMigration } from '../services/persistence/legacyPipelineMigrationRepository.js'
import { migrateLegacyPipelineConfigurations } from '../services/plugin/migrateLegacyPipelineConfigurations.js'
import {
  installDefaultNeo4jDatabase,
  resolveNeo4jDatabase,
} from '../services/neo4jDatabase.js'

const uri = process.env.NEO4J_URI || 'bolt://localhost:7687'
const user = process.env.NEO4J_USERNAME || process.env.NEO4J_USER || 'neo4j'
const password = process.env.NEO4J_PASSWORD

if (!password) {
  throw new Error('NEO4J_PASSWORD is required to migrate plugin pipelines')
}

const run = async () => {
  const driver = installDefaultNeo4jDatabase(
    neo4j.driver(uri, neo4j.auth.basic(user, password)),
    resolveNeo4jDatabase()
  )
  const repository = await initializeLegacyPipelineMigration(driver)

  try {
    await migrateLegacyPipelineConfigurations(repository, console.log)
  } finally {
    await driver.close()
  }
}

run().catch(error => {
  console.error('Plugin pipeline migration failed', error)
  process.exitCode = 1
})
