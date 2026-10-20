import { createInstancePolicyRepository } from "../services/persistence/instancePolicyRepository.js";
// Shared dependency bag for the custom resolver builders.
//
// customResolvers.ts used to create the OGM + every model and wire ~140
// resolvers inline in one ~740-line file. The OGM/model creation now lives here
// and is shared by the type/query/mutation resolver builders, each of which
// receives the same `ResolverDeps` object and destructures the models it needs.
import type { Driver } from "neo4j-driver";
import { protectIssueModelIdentity } from "../services/issueTargetIdentity.js";
import { createOgmPersistence } from "../services/persistence/ogm.js";

export function createOgmAndModels(driver: Driver) {
  const { ogm, repositories } = createOgmPersistence(driver);
  const Issue = protectIssueModelIdentity(ogm.model("Issue"));

  return {
    ogm,
    repositories,
    instancePolicyRepository: createInstancePolicyRepository(driver),
    driver,
    Discussion: ogm.model("Discussion"),
    DiscussionChannel: ogm.model("DiscussionChannel"),
    Event: ogm.model("Event"),
    EventChannel: ogm.model("EventChannel"),
    EventSeries: ogm.model("EventSeries"),
    Comment: ogm.model("Comment"),
    User: ogm.model("User"),
    ModerationProfile: ogm.model("ModerationProfile"),
    Email: ogm.model("Email"),
    Channel: ogm.model("Channel"),
    Tag: ogm.model("Tag"),
    Issue,
    ChannelRole: ogm.model("ChannelRole"),
    ModChannelRole: ogm.model("ModChannelRole"),
    ServerRole: ogm.model("ServerRole"),
    ModServerRole: ogm.model("ModServerRole"),
    ServerConfig: ogm.model("ServerConfig"),
    Suspension: ogm.model("Suspension"),
    Plugin: ogm.model("Plugin"),
    PluginVersion: ogm.model("PluginVersion"),
    PluginPipelineRun: ogm.model("PluginPipelineRun"),
    PluginPipelineCampaign: ogm.model("PluginPipelineCampaign"),
    PluginRun: ogm.model("PluginRun"),
    DownloadableFile: ogm.model("DownloadableFile"),
    ServerSecret: ogm.model("ServerSecret"),
    Image: ogm.model("Image"),
    Album: ogm.model("Album"),
    Collection: ogm.model("Collection"),
    WikiPage: ogm.model("WikiPage"),
    TextVersion: ogm.model("TextVersion"),
    FilterOption: ogm.model("FilterOption"),
    ModerationAction: ogm.model("ModerationAction"),
    LabelChangeHistory: ogm.model("LabelChangeHistory"),
    ScratchpadEntry: ogm.model("ScratchpadEntry"),
  };
}

export type ResolverDeps = ReturnType<typeof createOgmAndModels>;
