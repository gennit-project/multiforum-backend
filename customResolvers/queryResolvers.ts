// Query resolvers. Extracted from customResolvers.ts; receives the shared
// ResolverDeps and wires the custom query resolvers to their models/driver.
import type { ResolverDeps } from "./resolverDeps.js";
import getSiteWideDiscussionList from "./queries/getSiteWideDiscussionList.js";
import getSiteWideWikiList from "./queries/getSiteWideWikiList.js";
import getCommentSection from "./queries/getCommentSection.js";
import getEventComments from "./queries/getEventComments.js";
import getCommentReplies from "./queries/getCommentReplies.js";
import getDiscussionsInChannel from "./queries/getDiscussionsInChannel.js";
import getUserContributions from "./queries/getUserContributions.js";
import getChannelContributions from "./queries/getChannelContributions.js";
import getModContributions from "./queries/getModContributions.js";
import getUserFavoriteComment from "./queries/getUserFavoriteComment.js";
import getSortedChannels from "./queries/getSortedChannels.js";
import isOriginalPosterSuspended from "./queries/isOriginalPosterSuspended.js";
import safetyCheck from "./queries/safetyCheck.js";
import getServerPluginSecrets from "./queries/getServerPluginSecrets.js";
import getInstalledPlugins from "./queries/getInstalledPlugins.js";
import getPluginRunsForDownloadableFile from "./queries/getPluginRunsForDownloadableFile.js";
import getPipelineRuns from "./queries/getPipelineRuns.js";
import publicCollectionsContaining from "./queries/publicCollectionsContaining.js";

export default function buildQueryResolvers(deps: ResolverDeps) {
  const {
    ogm,
    driver,
    Discussion,
    DiscussionChannel,
    Event,
    Comment,
    User,
    ModerationProfile,
    Channel,
    Issue,
    ServerConfig,
    ServerSecret,
    PluginRun,
  } = deps;

  return {
    getSiteWideDiscussionList: getSiteWideDiscussionList({
      Discussion,
      driver,
    }),
    getSiteWideWikiList: getSiteWideWikiList({
      driver,
    }),
    getDiscussionsInChannel: getDiscussionsInChannel({
      driver,
      DiscussionChannel,
    }),
    getCommentSection: getCommentSection({
      driver,
      DiscussionChannel,
    }),
    getEventComments: getEventComments({
      driver,
      Event,
    }),
    getCommentReplies: getCommentReplies({
      driver,
      Comment,
    }),
    getUserFavoriteComment: getUserFavoriteComment({
      driver,
    }),
    getSortedChannels: getSortedChannels({
      driver,
    }),
    getUserContributions: getUserContributions({
      User,
      driver,
    }),
    getChannelContributions: getChannelContributions({
      Channel,
      driver,
    }),
    getModContributions: getModContributions({
      ModerationProfile,
      driver,
    }),
    isOriginalPosterSuspended: isOriginalPosterSuspended({
      Issue,
      Discussion,
      Event,
      Comment,
      Channel,
      User
    }),
    safetyCheck: safetyCheck,
    getServerPluginSecrets: getServerPluginSecrets({
      ServerSecret
    }),
    getInstalledPlugins: getInstalledPlugins({
      ServerConfig
    }),
    getPluginRunsForDownloadableFile: getPluginRunsForDownloadableFile({
      PluginRun
    }),
    getPipelineRuns: getPipelineRuns({
      PluginRun
    }),
    publicCollectionsContaining: publicCollectionsContaining({
      driver,
      ogm
    })
  };
}
