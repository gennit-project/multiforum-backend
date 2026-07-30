// Composition root for the custom GraphQL resolvers.
//
// This used to be a ~740-line file that created the OGM + every model and wired
// ~140 resolvers inline. The OGM/model setup now lives in
// customResolvers/resolverDeps.ts and the wiring is split across the
// type/query/mutation resolver builders below. The exported factory signature
// remains backwards compatible and also exposes the two pipeline models needed
// by the background watchdog.
import type { Driver } from "neo4j-driver";
import { createOgmAndModels } from "./customResolvers/resolverDeps.js";
import buildTypeResolvers from "./customResolvers/typeResolvers.js";
import buildQueryResolvers from "./customResolvers/queryResolvers.js";
import buildMutationResolvers from "./customResolvers/mutationResolvers.js";

export default function (driver: Driver) {
  const deps = createOgmAndModels(driver);

  const resolvers = {
    ...buildTypeResolvers(deps),
    Query: buildQueryResolvers(deps),
    Mutation: buildMutationResolvers(deps),
  };

  return {
    resolvers,
    ogm: deps.ogm,
    pipelineWatchdogModels: {
      PluginRun: deps.PluginRun,
      PluginPipelineRun: deps.PluginPipelineRun,
      DownloadableFile: deps.DownloadableFile,
      User: deps.User,
    },
    pipelineCampaignModels: {
      DownloadableFile: deps.DownloadableFile,
      Plugin: deps.Plugin,
      PluginVersion: deps.PluginVersion,
      PluginPipelineRun: deps.PluginPipelineRun,
      PluginRun: deps.PluginRun,
      PluginPipelineCampaign: deps.PluginPipelineCampaign,
      ServerConfig: deps.ServerConfig,
      ServerSecret: deps.ServerSecret,
      User: deps.User,
    },
  };
}
