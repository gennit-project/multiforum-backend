/** Exact native Cypher columns, before existing channel-name normalization. */
export type ContentChannelsRow = { found: boolean; channelUniqueNames: unknown[] };
export type ChannelNameRow = { channelUniqueName: unknown };
export type CommentChannelReferencesRow = {
  found: boolean;
  discussionChannelUniqueName: unknown;
  directChannelUniqueName: unknown;
};
