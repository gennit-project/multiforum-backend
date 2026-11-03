import type {MutationResolvers} from '../../src/generated/graphql.js';
import type {GraphQLContext} from '../../types/context.js';
import type {SelectedResolver} from './selection.js';
import {startedAttemptSelection,returnedJobSelection} from './pluginExecutionProjections.js';
export {startedAttemptSelection,returnedJobSelection};
export const pluginExecutionMutationNames=['rerunPluginPipeline','retryDownloadableFileScan','startPluginPipeline','triggerDownloadableFilePluginRuns'] as const;
export type PluginExecutionMutationResolvers={
 rerunPluginPipeline:SelectedResolver<MutationResolvers<GraphQLContext>['rerunPluginPipeline'],typeof startedAttemptSelection>;
 startPluginPipeline:SelectedResolver<MutationResolvers<GraphQLContext>['startPluginPipeline'],typeof startedAttemptSelection>;
 retryDownloadableFileScan:SelectedResolver<MutationResolvers<GraphQLContext>['retryDownloadableFileScan'],typeof returnedJobSelection>;
 triggerDownloadableFilePluginRuns:SelectedResolver<MutationResolvers<GraphQLContext>['triggerDownloadableFilePluginRuns'],typeof returnedJobSelection>;
};
