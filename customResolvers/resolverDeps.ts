// Shared dependency bag for the custom resolver builders.
//
// customResolvers.ts used to create the OGM + every model and wire ~140
// resolvers inline in one ~740-line file. The OGM/model creation now lives here
// and is shared by the type/query/mutation resolver builders, each of which
// receives the same `ResolverDeps` object and destructures the models it needs.
import pkg from "@neo4j/graphql-ogm";
import type { Driver } from "neo4j-driver";
import typeDefs from "../typeDefs.js";
import { ModelMap } from "../ogm_types.js";

const { OGM } = pkg;

export function createOgmAndModels(driver: Driver) {
  const ogm = new OGM<ModelMap>({
    typeDefs,
    driver,
  });

  return {
    ogm,
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
    Issue: ogm.model("Issue"),
    ChannelRole: ogm.model("ChannelRole"),
    ModChannelRole: ogm.model("ModChannelRole"),
    ServerRole: ogm.model("ServerRole"),
    ModServerRole: ogm.model("ModServerRole"),
    ServerConfig: ogm.model("ServerConfig"),
    Suspension: ogm.model("Suspension"),
    Plugin: ogm.model("Plugin"),
    PluginVersion: ogm.model("PluginVersion"),
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
