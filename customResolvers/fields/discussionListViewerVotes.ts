import type { ViewerIdentity } from '../contracts/viewerReadProjections.js';

/** DiscussionChannelListItem has one producer: the owned hydration document.
 * Its vote maps contain only the typed viewer parameter, never arbitrary users
 * or generated response-key maps. Preserve the existing empty/null fallback.
 */
export function discussionListViewerVotes<Field extends 'UpvotedByUsers' | 'SuperUpvotedByUsers'>(field: Field) {
  return (parent: { [Key in Field]?: (ViewerIdentity | null)[] | null } | null | undefined): ViewerIdentity[] => {
    const value = parent?.[field];
    return Array.isArray(value) ? value.filter(item => item !== null) : [];
  };
}
