type Input = {
  driver: any;
  ogm: any;
};

const itemTypeWhereMap: Record<string, any> = {
  DISCUSSION: { Discussions_SOME: { id: undefined } },
  COMMENT: { Comments_SOME: { id: undefined } },
  DOWNLOAD: { Downloads_SOME: { id: undefined, hasDownload: true } },
  IMAGE: { Images_SOME: { id: undefined } },
  CHANNEL: { Channels_SOME: { uniqueName: undefined } },
};

const selectionSet = `
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
  Downloads(options: { limit: 5 }) {
    id
    title
    createdAt
    hasSensitiveContent
    Album {
      id
      imageOrder
      Images {
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
      ServerRoles {
        showAdminTag
      }
    }
  }
}
`;

const publicCollectionsContaining = ({ ogm }: Input) => {
  return async (_parent: any, args: any) => {
    const { itemId, itemType } = args;
    const whereTemplate = itemTypeWhereMap[itemType];

    if (!whereTemplate) {
      throw new Error(`Unsupported itemType: ${itemType}`);
    }

    const where = JSON.parse(JSON.stringify(whereTemplate));

    if (itemType === "CHANNEL") {
      where.Channels_SOME.uniqueName = itemId;
    } else {
      const key = Object.keys(where)[0];
      where[key].id = itemId;
    }

    const Collection = ogm.model("Collection");

    try {
      const collections = await Collection.find({
        where: {
          visibility: "PUBLIC",
          ...where,
        },
        options: { sort: [{ createdAt: "DESC" }] },
        selectionSet,
      });

      return collections;
    } catch (error) {
      console.error("Error fetching public collections containing item:", {
        itemId,
        itemType,
        error,
      });
      throw new Error("Failed to fetch public collections containing item");
    }
  };
};

export default publicCollectionsContaining;
