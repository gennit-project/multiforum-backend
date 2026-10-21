import { visit } from 'graphql';
import type { Driver } from 'neo4j-driver';
import { Neo4jGraphQL } from '@neo4j/graphql';
import typeDefs from '../../typeDefs.js';
import type { ServerConfig } from '../../ogm_types.js';
import { executeGeneratedOperation, registerGeneratedSchema } from './generatedSchemaOperations.js';
export const LEGACY_PIPELINE_CONFIG_SELECTION = `{
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
      }`;
export const LEGACY_PIPELINE_SAVE_SELECTION = `{ serverName serverDescription serverIconURL rankingSettingsJson rankingSettingsUpdatedBy allowedFileTypes featuredWikiPageIds enableDownloads enableEvents accountAgeGateEnabled minimumAccountAge sensitiveContentAgeGateEnabled minimumSensitiveContentAge brandingProductName brandingDocsURL brandingSourceURL brandingIssuesURL brandingSupportEmail brandingShowUpstreamLinks brandingLogoDarkURL brandingLogoAlt brandingFaviconURL brandingPrimaryColor pluginRegistries rules brandingCustomFooterLinks pluginPipelines rankingSettingsUpdatedAt }`;
export interface LegacyPipelineMigrationRepository {
  findConfigurations(): Promise<ServerConfig[]>;
  saveConfiguration(serverName: string | null | undefined, pluginPipelines: string): Promise<void>;
}
export function createLegacyPipelineMigrationRepository(driver: Driver): LegacyPipelineMigrationRepository {
  return {
    async findConfigurations() {
      const result = await executeGeneratedOperation<{serverConfigs:ServerConfig[]}>(driver,
        `query LegacyPipelineConfigurations { serverConfigs ${LEGACY_PIPELINE_CONFIG_SELECTION} }`, {});
      return result.serverConfigs;
    },
    async saveConfiguration(serverName, pluginPipelines) {
      await executeGeneratedOperation(driver,
        `mutation SaveLegacyPipelineConfiguration($where: ServerConfigWhere, $update: ServerConfigUpdateInput) { updateServerConfigs(where: $where, update: $update) { serverConfigs ${LEGACY_PIPELINE_SAVE_SELECTION} } }`,
        {where:{serverName},update:{pluginPipelines}});
    },
  };
}
// The CLI owns a standalone schema and driver; no application services are started.
export async function initializeLegacyPipelineMigration(driver: Driver) {
  // OGM's standalone CLI schema selected these internal scalar fields by default.
  // Expose only that legacy response projection in this private CLI schema; keep
  // their write restrictions and the application's typeDefs/schema unchanged.
  const internalProjection = new Set(['rankingSettingsJson', 'rankingSettingsUpdatedBy', 'rankingSettingsUpdatedAt']);
  const cliTypeDefs = visit(typeDefs, {
    ObjectTypeDefinition(node) {
      if (node.name.value !== 'ServerConfig') return;
      return {...node, fields: node.fields?.map(field => internalProjection.has(field.name.value)
        ? {...field, directives: field.directives?.filter(directive => directive.name.value !== 'selectable')}
        : field)};
    },
  });
  const neoSchema = new Neo4jGraphQL({driver, typeDefs: cliTypeDefs});
  registerGeneratedSchema(driver, await neoSchema.getSchema());
  return createLegacyPipelineMigrationRepository(driver);
}
