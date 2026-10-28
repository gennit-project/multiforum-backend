import { createPluginInstallRepository, type PluginInstallRepository } from "../../services/persistence/pluginInstallRepository.js";
import type { Driver } from "neo4j-driver"
import { createServerSecretRepository, type ServerSecretRepository } from "../../services/persistence/serverSecretRepository.js"
import crypto from 'crypto'
import type {
  PluginCreateInput,
  PluginUpdateInput,
  PluginVersionCreateInput,
  PluginVersionUpdateInput
} from '../../ogm_types.js'
import type { GraphQLResolveInfo } from 'graphql'
import { parseManifestFromTarball } from './shared/pluginManifest.js'
import type { GraphQLContext } from '../../types/context.js'
import { logger } from "../../logger.js";
import { downloadBytes, fetchMergedPluginRegistry, type RegistryVersion } from '../../services/plugin/registryService.js'
import { getPluginVersionCompatibility } from '../../services/plugin/compatibility.js'
import { reconcileSettings, type SettingsCarryOverReport } from '../../services/plugin/reconcileSettings.js'
import { migrateServerSecretRenames } from '../../services/plugin/reconcileSecrets.js'

type Input = { driver: Driver; serverSecretRepository?: ServerSecretRepository; pluginInstallRepository?: PluginInstallRepository }

type Args = {
  pluginId: string
  version: string
  carrySettings?: boolean
}

type InstalledVersionEdge = {
  properties?: { settingsJson?: unknown }
  node?: {
    id?: string
    version?: string
    manifest?: unknown
    Plugin?: { id?: string; name?: string }
  }
}

const buildReleaseMetadataPayload = (registryVersion: RegistryVersion) => ({
  registryUrl: registryVersion.registryUrl || null,
  releaseNotesUrl: registryVersion.releaseNotesUrl || null,
  sourceRepoUrl: registryVersion.sourceRepoUrl || null,
  sourceCommit: registryVersion.sourceCommit || null,
  minServerVersion: registryVersion.minServerVersion || null,
  apiVersion: registryVersion.apiVersion || null
})

const getResolver = (input: Input, { fetchRegistry = fetchMergedPluginRegistry, download = downloadBytes, readManifest = parseManifestFromTarball }: { fetchRegistry?: typeof fetchMergedPluginRegistry; download?: typeof downloadBytes; readManifest?: typeof parseManifestFromTarball } = {}) => {
  const { serverSecretRepository = createServerSecretRepository(input.driver) } = input
  const repository = input.pluginInstallRepository ?? createPluginInstallRepository(input.driver)

  return async (_parent: unknown, args: Args, _context: GraphQLContext, _resolveInfo: GraphQLResolveInfo) => {
    const { pluginId, version, carrySettings = false } = args

    try {
      // 1. Get server config to find registry URLs
      const serverConfigs = await repository.findInstallConfigs()

      if (!serverConfigs.length || !serverConfigs[0].pluginRegistries?.length) {
        throw new Error('No plugin registries configured')
      }

      const registryUrls = (serverConfigs[0].pluginRegistries || [])
        .filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
      logger.info('Using plugin registry URLs:', registryUrls)
      const registryData = await fetchRegistry(registryUrls)

      // First, resolve the plugin node using either the Neo4j ID or the plugin slug
      const pluginCandidates = await repository.findInstallPlugin(pluginId)

      let pluginRecord = pluginCandidates[0] || null
      let pluginSlug = pluginRecord?.name || pluginId

      // Check if this version already exists in the database
      const existingDbVersions = await repository.findInstallVersion(version, pluginSlug)

      let registryVersion: RegistryVersion

      // Always get the version data from the registry for integrity verification
      const registryPlugin = registryData.plugins.find(p => p.id === pluginSlug)
      if (!registryPlugin) {
        throw new Error(`Plugin ${pluginSlug} not found in registry`)
      }

      const registryVersionData = registryPlugin.versions.find(v => v.version === version)
      if (!registryVersionData) {
        throw new Error(`Plugin ${pluginSlug} version ${version} not found in registry`)
      }

      if (existingDbVersions.length > 0) {
        const dbVersion = existingDbVersions[0]
        logger.info(`Found existing version in database: ${pluginSlug}@${version}`)
        // Use database URL but always use registry hash for verification
        registryVersion = {
          ...registryVersionData,
          version: dbVersion.version,
          tarballUrl: dbVersion.repoUrl || registryVersionData.tarballUrl,
          integritySha256: registryVersionData.integritySha256 // Always use registry hash
        }
      } else {
        registryVersion = registryVersionData
      }

      const compatibility = getPluginVersionCompatibility(registryVersion)
      if (!compatibility.compatible) {
        throw new Error(compatibility.message)
      }

      logger.info('Using version data:', JSON.stringify(registryVersion, null, 2))

      // 3. Download and verify tarball integrity
      logger.info(`Downloading tarball from: ${registryVersion.tarballUrl}`)
      
      const tarballBytes = await download(registryVersion.tarballUrl)

      // 4. Verify integrity
      const actualSha256 = crypto.createHash('sha256').update(tarballBytes).digest('hex')
      logger.info('Tarball integrity check:')
      logger.info('  Expected SHA-256:', registryVersion.integritySha256)
      logger.info('  Actual SHA-256:  ', actualSha256)
      logger.info('  Tarball size:    ', tarballBytes.length, 'bytes')
      if (actualSha256 !== registryVersion.integritySha256) {
        throw new Error(`Tarball integrity verification failed: SHA-256 mismatch. Expected: ${registryVersion.integritySha256}, Got: ${actualSha256}`)
      }

      const artifacts = await readManifest(tarballBytes)

      if (artifacts.version !== version) {
        throw new Error(`Manifest version ${artifacts.version} doesn't match requested version ${version}`)
      }

      if (artifacts.id !== pluginSlug) {
        throw new Error(`Manifest ID ${artifacts.id} doesn't match requested plugin ${pluginSlug}`)
      }

      type PluginManifestMetadata = {
        author?: { name?: string; url?: string }
        tags?: unknown[]
        homepage?: string
        license?: string
        [key: string]: unknown
      }
      type PluginManifest = {
        name?: string
        description?: string
        homepage?: string
        license?: string
        metadata?: PluginManifestMetadata
        settingsDefaults?: unknown
        settings?: unknown
        ui?: unknown
        documentation?: { readmePath?: string }
        [key: string]: unknown
      }
      const manifest = (artifacts.manifest || {}) as PluginManifest
      const metadata = (manifest.metadata || {}) as PluginManifestMetadata
      const author = metadata.author || {}
      const tags = Array.isArray(metadata.tags) ? metadata.tags.filter((tag: unknown) => typeof tag === 'string') : []

      const pluginUpdatePayload = {
        displayName: manifest.name || pluginSlug,
        description: manifest.description || null,
        authorName: author.name || null,
        authorUrl: author.url || null,
        homepage: metadata.homepage || manifest.homepage || null,
        license: metadata.license || manifest.license || null,
        tags,
        metadata: metadata && Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null
      }

      if (!pluginRecord) {
        logger.info(`Creating new plugin record for ${artifacts.id}`)
        const createResult = await repository.createInstallPlugin([
            ({
              name: artifacts.id,
              displayName: pluginUpdatePayload.displayName,
              description: pluginUpdatePayload.description,
              authorName: pluginUpdatePayload.authorName,
              authorUrl: pluginUpdatePayload.authorUrl,
              homepage: pluginUpdatePayload.homepage,
              license: pluginUpdatePayload.license,
              tags: pluginUpdatePayload.tags,
              metadata: pluginUpdatePayload.metadata
            } as unknown as PluginCreateInput)
          ])
        pluginRecord = createResult.plugins[0]
      } else {
        await repository.updateInstallPlugin(pluginRecord.id, ({
            displayName: { set: pluginUpdatePayload.displayName },
            description: { set: pluginUpdatePayload.description },
            authorName: { set: pluginUpdatePayload.authorName },
            authorUrl: { set: pluginUpdatePayload.authorUrl },
            homepage: { set: pluginUpdatePayload.homepage },
            license: { set: pluginUpdatePayload.license },
            tags: { set: pluginUpdatePayload.tags },
            metadata: { set: pluginUpdatePayload.metadata }
          } as unknown as PluginUpdateInput))
      }

      pluginSlug = artifacts.id

      let pluginVersion = existingDbVersions[0] || null
      // Neo4j only accepts primitive types, so stringify nested objects
      const settingsDefaultsRaw = manifest.settingsDefaults ?? manifest.settings ?? null
      const uiSchemaRaw = manifest.ui ?? null
      const settingsDefaults = settingsDefaultsRaw ? JSON.stringify(settingsDefaultsRaw) : null
      const uiSchema = uiSchemaRaw ? JSON.stringify(uiSchemaRaw) : null
      const manifestJson = artifacts.manifest ? JSON.stringify(artifacts.manifest) : null
      const documentationPath = artifacts.readmePath ?? manifest.documentation?.readmePath ?? null
      const readmeMarkdown = artifacts.readmeMarkdown ?? null
      const releaseMetadataPayload = buildReleaseMetadataPayload(registryVersion)

      if (!pluginVersion) {
        logger.info(`Creating new plugin version: ${pluginSlug}@${version}`)
        const createResult = await repository.createInstallVersion([
            ({
              version,
              repoUrl: String(registryVersion.tarballUrl),
              tarballGsUri: String(registryVersion.tarballUrl),
              integritySha256: String(registryVersion.integritySha256),
              ...releaseMetadataPayload,
              entryPath: artifacts.entryPath || 'index.js',
              manifest: manifestJson,
              settingsDefaults,
              uiSchema,
              documentationPath,
              readmeMarkdown,
              Plugin: {
                connect: {
                  where: { node: { id: pluginRecord!.id } }
                }
              }
            } as unknown as PluginVersionCreateInput)
          ])
        pluginVersion = createResult.pluginVersions[0]
      } else {
        await repository.updateInstallVersion(pluginVersion.id, ({
            repoUrl: { set: String(registryVersion.tarballUrl) },
            tarballGsUri: { set: String(registryVersion.tarballUrl) },
            integritySha256: { set: String(registryVersion.integritySha256) },
            ...Object.fromEntries(Object.entries(releaseMetadataPayload).map(([key, value]) => [key, { set: value }])),
            entryPath: { set: artifacts.entryPath || pluginVersion.entryPath || 'index.js' },
            manifest: { set: manifestJson },
            settingsDefaults: { set: settingsDefaults },
            uiSchema: { set: uiSchema },
            documentationPath: { set: documentationPath },
            readmeMarkdown: { set: readmeMarkdown }
          } as unknown as PluginVersionUpdateInput), pluginRecord!.id)
      }

      const serverConfig = serverConfigs[0]

      const installedVersions = await repository.findInstalledVersions(serverConfig.serverName)

      const installedEdges = (
        installedVersions[0]?.InstalledVersionsConnection?.edges || []
      ) as InstalledVersionEdge[]
      const isAlreadyInstalled = installedEdges.some(
        edge => edge.node?.id === pluginVersion.id
      )
      const previousVersionEdge = installedEdges.find(
        edge =>
          edge.node?.Plugin?.name === pluginSlug &&
          edge.node?.id !== pluginVersion.id
      )
      let reconciledSettings: Record<string, unknown> | null = null
      let carryOverReport: SettingsCarryOverReport | null = null

      if (carrySettings && previousVersionEdge) {
        const reconciled = reconcileSettings({
          oldSettings: previousVersionEdge.properties?.settingsJson,
          oldManifest: previousVersionEdge.node?.manifest,
          newManifest: artifacts.manifest,
          scope: 'server'
        })
        reconciledSettings = reconciled.settings
        carryOverReport = reconciled.report
        carryOverReport.renamedSecrets = await migrateServerSecretRenames({
          serverSecretRepository,
          pluginId: pluginSlug,
          oldManifest: previousVersionEdge.node?.manifest,
          newManifest: artifacts.manifest
        })
      }

      if (!isAlreadyInstalled) {
        logger.info('Installing plugin version, serverName:', serverConfig.serverName, 'pluginVersion.id:', pluginVersion.id)

        await repository.connectInstallation(String(serverConfig.serverName), String(pluginVersion.id), reconciledSettings
                  ? JSON.stringify(reconciledSettings)
                  : null)
      }

      return {
        plugin: {
          id: String(pluginRecord!.id),
          name: String(pluginRecord!.name),
          displayName: pluginUpdatePayload.displayName,
          description: pluginUpdatePayload.description,
          authorName: pluginUpdatePayload.authorName,
          authorUrl: pluginUpdatePayload.authorUrl,
          homepage: pluginUpdatePayload.homepage,
          license: pluginUpdatePayload.license,
          tags: pluginUpdatePayload.tags,
          metadata: pluginUpdatePayload.metadata
        },
        version: String(version),
        scope: 'SERVER',
        enabled: false,
        settingsJson: reconciledSettings,
        carryOverReport
      }

    } catch (error: unknown) {
      logger.error('Error in installPluginVersion resolver:', error)
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to install plugin: ${message}`)
    }
  }
}

export default getResolver
