import { GraphQLError } from "graphql";
import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import {
  claimUploadAuditMetadata,
  getUnclaimedUploadAuditMetadataByUrl,
} from "../../services/uploadStorageMetadata.js";
import {
  USER_AVATAR_VARIANT_KEYS,
  buildChannelIconVariantPersistenceFields,
  generateImageVariants,
} from "../../services/imageVariants.js";

type Args = {
  channelUniqueName: string;
  imageUrl: string;
};

type ResolverInput = {
  Channel: {
    update: (args: {
      where: { uniqueName: string };
      update: Record<string, unknown>;
      selectionSet: string;
    }) => Promise<{ channels: Array<Record<string, unknown>> }>;
  };
  driver: Driver;
  generateVariants?: typeof generateImageVariants;
};

const selectionSet = `
  {
    uniqueName
    channelIconURL
    variantUrls
    icon32Url
    icon48Url
    icon64Url
    icon96Url
  }
`;

const getResolver = ({
  Channel,
  driver,
  generateVariants = generateImageVariants,
}: ResolverInput) => {
  return async (
    _parent: unknown,
    args: Args,
    context: GraphQLContext
  ): Promise<Record<string, unknown>> => {
    if (!context.user?.username) {
      context.user = await setUserDataOnContext({ context });
    }

    const actingUsername = context.user?.username;
    if (!actingUsername) {
      throw new GraphQLError("User must be logged in");
    }

    if (!args.channelUniqueName?.trim()) {
      throw new GraphQLError("Channel unique name is required");
    }

    if (!args.imageUrl?.trim()) {
      throw new GraphQLError("Image URL is required");
    }

    const uploadMetadata = await getUnclaimedUploadAuditMetadataByUrl({
      driver,
      storageUrl: args.imageUrl,
      username: actingUsername,
    });

    if (!uploadMetadata?.storageBucket || !uploadMetadata.storageObjectName) {
      throw new GraphQLError("Upload metadata not found for the selected channel icon");
    }

    const generatedVariants = await generateVariants({
      storageBucket: uploadMetadata.storageBucket,
      storageObjectName: uploadMetadata.storageObjectName,
      variantKeys: USER_AVATAR_VARIANT_KEYS,
    });

    const response = await Channel.update({
      where: { uniqueName: args.channelUniqueName },
      update: {
        channelIconURL: args.imageUrl,
        ...buildChannelIconVariantPersistenceFields(generatedVariants),
      },
      selectionSet: `{ channels ${selectionSet} }`,
    });

    const updatedChannel = response.channels[0];
    if (!updatedChannel) {
      throw new GraphQLError("Channel not found");
    }

    await claimUploadAuditMetadata({
      driver,
      storageObjectName: uploadMetadata.storageObjectName,
      username: actingUsername,
      claimedByType: "ChannelIcon",
      claimedById: args.channelUniqueName,
    });

    return updatedChannel;
  };
};

export default getResolver;
