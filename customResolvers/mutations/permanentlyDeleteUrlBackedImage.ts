import { GraphQLError } from "graphql";
import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";
import { hasServerModPermission } from "../../rules/permission/hasServerModPermission.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import {
  deleteStoredObject,
  type StoredObjectMetadata,
} from "../../services/storageDeletion.js";

type DeleteObject = typeof deleteStoredObject;
type CheckServerModPermission = typeof hasServerModPermission;

type ReferenceType = "ProfileImage" | "ChannelBanner";

type UrlBackedImageTarget = StoredObjectMetadata & {
  ownerUsername?: string | null;
  channelUniqueName?: string | null;
  channelOwnerUsernames?: string[];
  currentUrl?: string | null;
};

type ResolverInput = {
  driver: Driver;
  referenceType: ReferenceType;
  deleteObject?: DeleteObject;
  checkServerModPermission?: CheckServerModPermission;
};

type Args = {
  username?: string;
  channelUniqueName?: string;
  imageUrl?: string;
};

const getRequiredArg = (value: string | undefined, message: string): string => {
  if (!value?.trim()) {
    throw new GraphQLError(message);
  }

  return value;
};

const readTarget = async ({
  driver,
  referenceType,
  username,
  channelUniqueName,
  imageUrl,
}: {
  driver: Driver;
  referenceType: ReferenceType;
  username?: string;
  channelUniqueName?: string;
  imageUrl: string;
}): Promise<UrlBackedImageTarget | null> => {
  const session = driver.session({ defaultAccessMode: "READ" });

  try {
    const result = await session.run(
      referenceType === "ProfileImage"
        ? `
          MATCH (target:User {username: $username})
          WHERE target.profilePicURL = $imageUrl
          OPTIONAL MATCH (audit:UploadedFileAudit {storageUrl: $imageUrl})
          RETURN
            target.username AS ownerUsername,
            target.profilePicURL AS currentUrl,
            audit.storageBucket AS storageBucket,
            audit.storageObjectName AS storageObjectName,
            null AS channelUniqueName,
            [] AS channelOwnerUsernames
          `
        : `
          MATCH (target:Channel {uniqueName: $channelUniqueName})
          WHERE target.channelBannerURL = $imageUrl
          OPTIONAL MATCH (admin:User)-[:ADMIN_OF_CHANNEL]->(target)
          OPTIONAL MATCH (audit:UploadedFileAudit {storageUrl: $imageUrl})
          RETURN
            null AS ownerUsername,
            target.channelBannerURL AS currentUrl,
            audit.storageBucket AS storageBucket,
            audit.storageObjectName AS storageObjectName,
            target.uniqueName AS channelUniqueName,
            collect(DISTINCT admin.username) AS channelOwnerUsernames
          `,
      { username, channelUniqueName, imageUrl }
    );

    const record = result.records[0];
    if (!record) {
      return null;
    }

    return {
      ownerUsername: record.get("ownerUsername"),
      channelUniqueName: record.get("channelUniqueName"),
      channelOwnerUsernames: record.get("channelOwnerUsernames") || [],
      currentUrl: record.get("currentUrl"),
      storageBucket: record.get("storageBucket"),
      storageObjectName: record.get("storageObjectName"),
    };
  } finally {
    await session.close();
  }
};

const assertCanDelete = async ({
  context,
  target,
  checkServerModPermission,
}: {
  context: GraphQLContext;
  target: UrlBackedImageTarget;
  checkServerModPermission: CheckServerModPermission;
}): Promise<void> => {
  if (!context.user?.username) {
    context.user = await setUserDataOnContext({ context });
  }

  const username = context.user?.username || null;
  if (!username) {
    throw new GraphQLError("User must be logged in");
  }

  if (
    target.ownerUsername === username ||
    target.channelOwnerUsernames?.includes(username)
  ) {
    return;
  }

  const serverModPermission = await checkServerModPermission(
    "canPermanentlyRemoveImage",
    context
  );

  if (serverModPermission === true) {
    return;
  }

  throw new GraphQLError(
    serverModPermission instanceof Error
      ? serverModPermission.message
      : "Not authorized to permanently delete this image"
  );
};

const clearReference = async ({
  driver,
  referenceType,
  username,
  channelUniqueName,
  imageUrl,
  removedByUsername,
  removedByModName,
}: {
  driver: Driver;
  referenceType: ReferenceType;
  username?: string;
  channelUniqueName?: string;
  imageUrl: string;
  removedByUsername: string;
  removedByModName?: string | null;
}): Promise<Record<string, unknown>> => {
  const session = driver.session({ defaultAccessMode: "WRITE" });
  const removedAt = new Date().toISOString();

  try {
    const result = await session.run(
      referenceType === "ProfileImage"
        ? `
          MATCH (target:User {username: $username})
          WHERE target.profilePicURL = $imageUrl
          SET target.profilePicURL = null
          WITH target
          OPTIONAL MATCH (audit:UploadedFileAudit {storageUrl: $imageUrl})
          SET audit.permanentlyRemoved = true,
              audit.permanentlyRemovedAt = datetime($removedAt),
              audit.permanentlyRemovedByUsername = $removedByUsername,
              audit.permanentlyRemovedByModName = $removedByModName
          RETURN target.username AS username,
                 target.profilePicURL AS profilePicURL
          `
        : `
          MATCH (target:Channel {uniqueName: $channelUniqueName})
          WHERE target.channelBannerURL = $imageUrl
          SET target.channelBannerURL = null
          WITH target
          OPTIONAL MATCH (audit:UploadedFileAudit {storageUrl: $imageUrl})
          SET audit.permanentlyRemoved = true,
              audit.permanentlyRemovedAt = datetime($removedAt),
              audit.permanentlyRemovedByUsername = $removedByUsername,
              audit.permanentlyRemovedByModName = $removedByModName
          RETURN target.uniqueName AS uniqueName,
                 target.channelBannerURL AS channelBannerURL
          `,
      {
        username,
        channelUniqueName,
        imageUrl,
        removedAt,
        removedByUsername,
        removedByModName: removedByModName || null,
      }
    );

    const record = result.records[0];
    if (!record) {
      throw new GraphQLError("Image reference changed before deletion completed");
    }

    return Object.fromEntries(record.keys.map((key) => [key, record.get(key)]));
  } finally {
    await session.close();
  }
};

const getResolver = ({
  driver,
  referenceType,
  deleteObject = deleteStoredObject,
  checkServerModPermission = hasServerModPermission,
}: ResolverInput) => {
  return async (
    parent: unknown,
    args: Args,
    context: GraphQLContext
  ): Promise<Record<string, unknown>> => {
    const imageUrl = getRequiredArg(args.imageUrl, "Image URL is required");
    const username =
      referenceType === "ProfileImage"
        ? getRequiredArg(args.username, "Username is required")
        : undefined;
    const channelUniqueName =
      referenceType === "ChannelBanner"
        ? getRequiredArg(args.channelUniqueName, "Channel unique name is required")
        : undefined;

    const target = await readTarget({
      driver,
      referenceType,
      username,
      channelUniqueName,
      imageUrl,
    });

    if (!target) {
      throw new GraphQLError("Active image reference not found");
    }

    if (!target.storageBucket || !target.storageObjectName) {
      throw new GraphQLError("Storage metadata not found for active image");
    }

    await assertCanDelete({
      context,
      target,
      checkServerModPermission,
    });

    await deleteObject({
      storageBucket: target.storageBucket,
      storageObjectName: target.storageObjectName,
    });

    return clearReference({
      driver,
      referenceType,
      username,
      channelUniqueName,
      imageUrl,
      removedByUsername: context.user?.username || "",
      removedByModName: context.user?.data?.ModerationProfile?.displayName || null,
    });
  };
};

export default getResolver;
