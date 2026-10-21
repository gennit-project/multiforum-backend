import type { Driver } from "neo4j-driver";
import getCustomResolvers from "../../customResolvers.js";
import { createOgmPersistence } from "../../services/persistence/ogm.js";

// The models the pre-removal composition root (createOgmAndModels) instantiated
// up front. They must be created BEFORE a test calls
// initializeOgmFromExistingSchema, which only hydrates models already present on
// the OGM — rewriting each model's default selection set to drop private output
// fields (e.g. DownloadableFile.ageGateRestricted) that the public schema omits.
// A model created lazily after init keeps its raw default selection and would
// request those private fields, so instantiate them here to preserve ordering.
const OGM_MODEL_NAMES = [
  "Album", "Channel", "ChannelRole", "Comment", "Discussion", "DiscussionChannel",
  "DownloadableFile", "Event", "EventChannel", "EventSeries", "FilterOption", "Image",
  "Issue", "LabelChangeHistory", "ModChannelRole", "ModServerRole", "ModerationAction",
  "ModerationProfile", "Plugin", "PluginPipelineCampaign", "PluginPipelineRun",
  "PluginRun", "PluginVersion", "ScratchpadEntry", "ServerConfig", "ServerRole",
  "ServerSecret", "Suspension", "Tag", "TextVersion", "User", "WikiPage",
] as const;

// Test-only shim. Production no longer threads an OGM through the resolver
// composition root (getCustomResolvers), but the OGM-backed characterization
// tests still exercise the kept adapter directly. This wrapper mirrors the old
// `getCustomResolvers(driver)` shape (`{ resolvers, ogm }`) so those tests keep
// obtaining an OGM instance without the production wiring carrying one.
export default function getTestResolvers(driver: Driver) {
  const { resolvers } = getCustomResolvers(driver);
  const { ogm } = createOgmPersistence(driver);
  for (const name of OGM_MODEL_NAMES) ogm.model(name);
  return { resolvers, ogm };
}
