import type { Driver } from "neo4j-driver";
import type { PluginPolicyDomainMutationResolvers, PluginPolicyQueryResolvers } from "../../customResolvers/contracts/pluginPolicies.js";
import type { ChannelPipelineSettings, PipelineDownloadSnapshot, ServerPipelineSettings, ServerApplicabilityConfig } from "../../customResolvers/contracts/pluginPolicyProjections.js";
import updateServer from "../../customResolvers/mutations/updatePluginPipelines.js";
import updateChannel from "../../customResolvers/mutations/updateChannelPluginPipelines.js";
import applicable from "../../customResolvers/queries/getApplicablePluginPipeline.js";
declare const driver: Driver;
const updates = { updatePluginPipelines: updateServer({ driver }), updateChannelPluginPipelines: updateChannel({ driver }) } satisfies PluginPolicyDomainMutationResolvers;
const query = { getApplicablePluginPipeline: applicable({ driver }) } satisfies PluginPolicyQueryResolvers;
const nullableInputs: Parameters<ReturnType<typeof updateServer>>[1] = {
  pipelines: [{ event: "comment.created", steps: [{ pluginId: "bot", version: null, condition: null, continueOnError: null }], effectiveAt: null, applicability: null, policyId: null, stopOnFirstFailure: null }],
};
// @ts-expect-error explicit domain output cannot be an arbitrary JSON object
const badDomain: PluginPolicyDomainMutationResolvers["updatePluginPipelines"] = () => ({ anything: true });
// @ts-expect-error pipeline steps must carry pluginId
const badSteps: PluginPolicyDomainMutationResolvers["updateChannelPluginPipelines"] = () => [{ event: "comment.created", steps: [{}] }];
// @ts-expect-error selected computed Boolean cannot be string
const badQuery: PluginPolicyQueryResolvers["getApplicablePluginPipeline"] = () => ({ targetId: "f", targetType: "DownloadableFile", scope: "SERVER", channelId: null, configured: "yes", required: false, reason: "NO_APPLICABLE_PLUGINS", expectedJobs: [] });
// @ts-expect-error fixed channel read includes bot and plugin connection selections
const incomplete: ChannelPipelineSettings = { uniqueName: "forum", pluginPipelines: null };
const server: ServerPipelineSettings = { serverName: null, pluginPipelines: null };
const file: PipelineDownloadSnapshot = { id: "f", permanentlyRemoved: null, Discussion: null };
// @ts-expect-error unfetched file metadata is not part of visibility projection
file.fileName;
declare const config: ServerApplicabilityConfig;
// @ts-expect-error Plugin relation remains nullable in the generated selection
const name: string = config.InstalledVersionsConnection.edges[0].node.Plugin.name;
void [updates, query, nullableInputs, badDomain, badSteps, badQuery, incomplete, server, file, name];
