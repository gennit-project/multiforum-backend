import type { ScratchpadSuperVoter } from '../contracts/scratchpadSuperVoters.js';
/** Preserve the existing nullable-list fallback and raw voter objects. */
export function scratchpadSuperVoters(parent:{superUpvotedByUsers?:ScratchpadSuperVoter[] | null}):ScratchpadSuperVoter[] {
  return parent.superUpvotedByUsers || [];
}
