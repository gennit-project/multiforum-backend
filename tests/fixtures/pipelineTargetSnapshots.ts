import type { ModelMap } from "../../ogm_types.js";
import type { PipelineTargetRepository } from "../../services/persistence/pipelineTargetRepository.js";

/** Adapt existing in-memory test fixtures, never real persistence models. */
export const pipelineTargetSnapshots = (fixtures: Partial<Pick<ModelMap,
  "Discussion" | "DownloadableFile" | "Channel" | "ServerConfig"
>>): PipelineTargetRepository => ({
  findDiscussionVisibility: () => fixtures.Discussion?.find() ?? Promise.resolve([]),
  findDownloadVisibility: () => fixtures.DownloadableFile?.find() ?? Promise.resolve([]),
  findDownloadTiming: () => fixtures.DownloadableFile?.find() ?? Promise.resolve([]),
  listServerApplicabilityConfigs: async () => (await fixtures.ServerConfig?.find() ?? []) as unknown as Awaited<ReturnType<PipelineTargetRepository["listServerApplicabilityConfigs"]>>,
  findChannelApplicabilityConfig: () => fixtures.Channel?.find() ?? Promise.resolve([]),
});
