import type { ScratchpadEntryResolvers, User } from '../../src/generated/graphql.js';
import type { GraphQLContext } from '../../types/context.js';
import type { Selection } from './selection.js';
import type { RawSelectedSource, RawSelectedListResolver } from './rawSelectedSource.js';
export const scratchpadSuperVoterSelection = {username:true} as const satisfies Selection<User>;
export type ScratchpadSuperVoter = RawSelectedSource<User,typeof scratchpadSuperVoterSelection>;
export type ScratchpadSuperVoterSource = RawSelectedListResolver<
  ScratchpadEntryResolvers<GraphQLContext>['superUpvotedByUsers'],typeof scratchpadSuperVoterSelection>;
