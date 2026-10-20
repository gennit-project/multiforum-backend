import type { Driver } from "neo4j-driver";
import type { CollectionOptions, CollectionWhere } from "../../src/generated/graphql.js";
import { executeGeneratedOperation } from "./generatedSchemaOperations.js";

export type CollectionShareSnapshot = {
  id: string;
  name: string;
  description?: string | null;
  visibility: string;
  CreatedBy?: { username?: string | null } | null;
};
export interface CollectionReadRepository {
  findProfileCollections(where: CollectionWhere, options: CollectionOptions): Promise<Record<string, unknown>[]>;
  findPublicContaining(where: CollectionWhere, canViewSensitiveContent: boolean): Promise<Record<string, unknown>[]>;
  findOwnedShareTarget(id: string, username: string): Promise<CollectionShareSnapshot[]>;
  findShareChannel(uniqueName: string): Promise<Array<{ uniqueName: string }>>;
}

const PROFILE_COLLECTIONS = `query ProfileCollections($where: CollectionWhere, $options: CollectionOptions) {
  collections(where: $where, options: $options) {
        id
        name
        description
        visibility
        collectionType
        itemCount
        itemOrder
        createdAt
        updatedAt
        Channels {
          uniqueName
          displayName
          channelIconURL
        }
        Discussions {
          id
          title
        }
        Comments {
          id
          text
        }
        Downloads {
          id
          title
        }
        Images {
          id
          url
        }
      }
}`;

const selectionSetTemplate = `
{
  id
  name
  description
  visibility
  collectionType
  itemCount
  shareCount
  createdAt
  updatedAt
  itemOrder
  CreatedBy {
    username
    displayName
    profilePicURL
  }
  Downloads(options: { limit: 5 }__DISCUSSION_AGE_FILTER__) {
    id
    title
    createdAt
    hasSensitiveContent
    Album {
      id
      imageOrder
      Images__IMAGE_AGE_FILTER__ {
        id
        url
        caption
      }
    }
    DiscussionChannels {
      id
      channelUniqueName
      CommentsAggregate {
        count
      }
      Channel {
        uniqueName
        displayName
      }
    }
    Tags {
      text
    }
    Author {
      username
      displayName
      profilePicURL
      commentKarma
      discussionKarma
      createdAt
    }
  }
}
`;

const CLEAR_SOURCE_CONTENT_FILTER = "{ OR: [{ hasSensitiveContent: false }, { hasSensitiveContent: null }] }";

export const getPublicCollectionSelectionSet = (canViewSensitiveContent: boolean) =>
  selectionSetTemplate
    .replace(
      "__DISCUSSION_AGE_FILTER__",
      canViewSensitiveContent ? "" : `, where: ${CLEAR_SOURCE_CONTENT_FILTER}`
    )
    .replace(
      "__IMAGE_AGE_FILTER__",
      canViewSensitiveContent ? "" : `(where: ${CLEAR_SOURCE_CONTENT_FILTER})`
    );


// Only these two fixed public projections are supported. Caller input never
// becomes document text; arbitrary collection filters remain GraphQL variables.
const PUBLIC_COLLECTIONS = [false, true].map(canView => `query PublicCollectionsContaining($where: CollectionWhere) {
  collections(where: $where, options: {sort: [{createdAt: DESC}]}) ${getPublicCollectionSelectionSet(canView)}
}`);
const OWNED_SHARE_TARGET = `query OwnedCollectionShareTarget($where: CollectionWhere) {
  collections(where: $where) { id name description visibility CreatedBy { username } }
}`;
const SHARE_CHANNEL = `query CollectionShareChannel($where: ChannelWhere) {
  channels(where: $where) { uniqueName }
}`;

export function createCollectionReadRepository(driver: Driver): CollectionReadRepository {
  return {
    async findProfileCollections(where, options) {
      const result = await executeGeneratedOperation<{collections: Record<string, unknown>[]}>(driver,
        PROFILE_COLLECTIONS, { where, options });
      return result.collections;
    },
    async findPublicContaining(where, canViewSensitiveContent) {
      const result = await executeGeneratedOperation<{collections: Record<string, unknown>[]}>(driver,
        PUBLIC_COLLECTIONS[canViewSensitiveContent ? 1 : 0], { where });
      return result.collections;
    },
    async findOwnedShareTarget(id, username) {
      const result = await executeGeneratedOperation<{collections: CollectionShareSnapshot[]}>(driver,
        OWNED_SHARE_TARGET, { where: { id, CreatedBy: { username } } });
      return result.collections;
    },
    async findShareChannel(uniqueName) {
      const result = await executeGeneratedOperation<{channels: Array<{uniqueName: string}>}>(driver,
        SHARE_CHANNEL, { where: { uniqueName } });
      return result.channels;
    },
  };
}
