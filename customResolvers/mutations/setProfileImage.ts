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
  buildUserAvatarVariantPersistenceFields,
  generateImageVariants,
} from "../../services/imageVariants.js";

type Args = {
  username: string;
  imageUrl: string;
};

type ResolverInput = {
  User: {
    update: (args: {
      where: { username: string };
      update: Record<string, unknown>;
      selectionSet: string;
    }) => Promise<{ users: Array<Record<string, unknown>> }>;
  };
  driver: Driver;
  generateVariants?: typeof generateImageVariants;
};

const selectionSet = `
  {
    username
    profilePicURL
    variantUrls
    avatar32Url
    avatar48Url
    avatar64Url
    avatar96Url
  }
`;

const getResolver = ({
  User,
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

    if (actingUsername !== args.username) {
      throw new GraphQLError("Not authorized to update this profile image");
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
      throw new GraphQLError("Upload metadata not found for the selected profile image");
    }

    const generatedVariants = await generateVariants({
      storageBucket: uploadMetadata.storageBucket,
      storageObjectName: uploadMetadata.storageObjectName,
      variantKeys: USER_AVATAR_VARIANT_KEYS,
    });

    const response = await User.update({
      where: { username: args.username },
      update: {
        profilePicURL: args.imageUrl,
        ...buildUserAvatarVariantPersistenceFields(generatedVariants),
      },
      selectionSet: `{ users ${selectionSet} }`,
    });

    const updatedUser = response.users[0];
    if (!updatedUser) {
      throw new GraphQLError("User not found");
    }

    await claimUploadAuditMetadata({
      driver,
      storageObjectName: uploadMetadata.storageObjectName,
      username: actingUsername,
      claimedByType: "UserProfileImage",
      claimedById: args.username,
    });

    return updatedUser;
  };
};

export default getResolver;
