import type { ApplicablePluginPipeline, MutationResolvers, QueryResolvers } from "../../src/generated/graphql.js";
import type { GraphQLContext } from "../../types/context.js";
import type { EventPipelineInput } from "../mutations/updatePluginPipelines.js";
import type { Selection, SelectedResolver } from "./selection.js";

// Stored pipeline JSON is deliberately not decoded more strictly here. Only
// computed fields and schema-executed plugin-version strings are certified.
export const applicablePolicySelection = {
  targetId: true, targetType: true, scope: true, channelId: true,
  configured: true, required: true, reason: true,
  expectedJobs: { pluginName: true, version: true, order: true },
} as const satisfies Selection<ApplicablePluginPipeline>;
export const pluginPolicyQueryNames = ["getApplicablePluginPipeline"] as const;
export type PluginPolicyQueryResolvers = {
  getApplicablePluginPipeline: SelectedResolver<QueryResolvers<GraphQLContext>["getApplicablePluginPipeline"], typeof applicablePolicySelection>;
};

// JSON! has no generated structural output guarantee. These stronger domain
// checks retain generated arguments, but must remain a documented scalar-owned
// exception rather than being counted as a generated output contract.
type Callable<R> = Extract<NonNullable<R>, (...args: never[]) => unknown>;
type PipelineDomainResolver<R> = (...args: Parameters<Callable<R>>) => EventPipelineInput[] | Promise<EventPipelineInput[]>;
export const pluginPolicyDomainMutationNames = ["updatePluginPipelines", "updateChannelPluginPipelines"] as const;
export type PluginPolicyDomainMutationResolvers = {
  updatePluginPipelines: PipelineDomainResolver<MutationResolvers<GraphQLContext>["updatePluginPipelines"]>;
  updateChannelPluginPipelines: PipelineDomainResolver<MutationResolvers<GraphQLContext>["updateChannelPluginPipelines"]>;
};
