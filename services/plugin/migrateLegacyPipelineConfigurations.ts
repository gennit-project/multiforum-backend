import type { LegacyPipelineMigrationRepository } from '../persistence/legacyPipelineMigrationRepository.js';
import { materializeLegacyDownloadPipelines } from './legacyPipelineMigration.js';
import type { PluginEdgeData } from './types.js';

export async function migrateLegacyPipelineConfigurations(
  repository: LegacyPipelineMigrationRepository,
  log: (message: string) => void,
  materialize = materializeLegacyDownloadPipelines,
) {
  const configs = await repository.findConfigurations();
  for (const config of configs) {
    const result = materialize({
      storedPipelines: config.pluginPipelines,
      installedPluginEdges: (config.InstalledVersionsConnection?.edges || []) as unknown as PluginEdgeData[],
    });
    if (result.addedEvents.length === 0) continue;
    await repository.saveConfiguration(config.serverName, JSON.stringify(result.pipelines));
    log(`[pipeline-migration] ${config.serverName}: added ${result.addedEvents.join(', ')}`);
  }
}
