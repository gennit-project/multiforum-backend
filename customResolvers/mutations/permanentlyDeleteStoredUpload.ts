import { GraphQLError } from "graphql";
import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { hasServerModPermission } from "../../rules/permission/hasServerModPermission.js";
import {
  deleteStoredObject,
  type StoredObjectMetadata,
  type StorageDeletionResult,
} from "../../services/storageDeletion.js";

type MediaType = "Image" | "DownloadableFile";

type DeleteObject = typeof deleteStoredObject;
type CheckServerModPermission = typeof hasServerModPermission;

type PermanentlyDeleteStoredUploadInput = {
  driver: Driver;
  mediaType: MediaType;
  deleteObject?: DeleteObject;
  checkServerModPermission?: CheckServerModPermission;
};

type StoredUploadTarget = StoredObjectMetadata & {
  id: string;
  permanentlyRemoved: boolean;
  uploadedByUsername: string | null;
  discussionAuthorUsernames: string[];
};

type Args = {
  imageId?: string;
  downloadableFileId?: string;
};

const getTargetId = (mediaType: MediaType, args: Args): string => {
  const id =
    mediaType === "Image" ? args.imageId : args.downloadableFileId;

  if (!id) {
    throw new GraphQLError(
      mediaType === "Image"
        ? "Image ID is required"
        : "Downloadable file ID is required"
    );
  }

  return id;
};

const readStoredUploadTarget = async ({
  driver,
  mediaType,
  id,
}: {
  driver: Driver;
  mediaType: MediaType;
  id: string;
}): Promise<StoredUploadTarget | null> => {
  const session = driver.session({ defaultAccessMode: "READ" });

  try {
    const result = await session.run(
      mediaType === "Image"
        ? `
          MATCH (target:Image {id: $id})
          OPTIONAL MATCH (uploader:User)-[:UPLOADED_IMAGE]->(target)
          RETURN
            target.id AS id,
            coalesce(target.permanentlyRemoved, false) AS permanentlyRemoved,
            target.storageBucket AS storageBucket,
            target.storageObjectName AS storageObjectName,
            target.uploadedByUsername AS uploadedByUsername,
            uploader.username AS uploaderUsername,
            [] AS discussionAuthorUsernames
          `
        : `
          MATCH (target:DownloadableFile {id: $id})
          OPTIONAL MATCH (discussion:Discussion)-[:HAS_DOWNLOADABLE_FILE]->(target)
          OPTIONAL MATCH (author:User)-[:POSTED_DISCUSSION]->(discussion)
          RETURN
            target.id AS id,
            coalesce(target.permanentlyRemoved, false) AS permanentlyRemoved,
            target.storageBucket AS storageBucket,
            target.storageObjectName AS storageObjectName,
            target.uploadedByUsername AS uploadedByUsername,
            null AS uploaderUsername,
            collect(DISTINCT author.username) AS discussionAuthorUsernames
          `,
      { id }
    );

    const record = result.records[0];
    if (!record) {
      return null;
    }

    return {
      id: record.get("id"),
      permanentlyRemoved: Boolean(record.get("permanentlyRemoved")),
      storageBucket: record.get("storageBucket"),
      storageObjectName: record.get("storageObjectName"),
      uploadedByUsername:
        record.get("uploadedByUsername") || record.get("uploaderUsername") || null,
      discussionAuthorUsernames: record.get("discussionAuthorUsernames") || [],
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
  target: StoredUploadTarget;
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
    target.uploadedByUsername === username ||
    target.discussionAuthorUsernames.includes(username)
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
      : "Not authorized to permanently delete this upload"
  );
};

const markStoredUploadRemoved = async ({
  driver,
  mediaType,
  id,
  username,
  modProfileName,
}: {
  driver: Driver;
  mediaType: MediaType;
  id: string;
  username: string;
  modProfileName?: string | null;
}): Promise<Record<string, unknown>> => {
  const session = driver.session({ defaultAccessMode: "WRITE" });
  const removedAt = new Date().toISOString();

  try {
    const result = await session.run(
      mediaType === "Image"
        ? `
          MATCH (target:Image {id: $id})
          SET target.permanentlyRemoved = true,
              target.permanentlyRemovedAt = datetime($removedAt)
          WITH target
          OPTIONAL MATCH (removerUser:User {username: $username})
          FOREACH (_ IN CASE WHEN removerUser IS NULL THEN [] ELSE [1] END |
            MERGE (removerUser)-[:REMOVED_IMAGE]->(target)
          )
          WITH target
          OPTIONAL MATCH (removerMod:ModerationProfile {displayName: $modProfileName})
          FOREACH (_ IN CASE WHEN removerMod IS NULL THEN [] ELSE [1] END |
            MERGE (removerMod)-[:REMOVED_IMAGE]->(target)
          )
          RETURN
            target.id AS id,
            target.url AS url,
            target.storageBucket AS storageBucket,
            target.storageObjectName AS storageObjectName,
            target.storageUrl AS storageUrl,
            target.permanentlyRemoved AS permanentlyRemoved,
            toString(target.permanentlyRemovedAt) AS permanentlyRemovedAt
          `
        : `
          MATCH (target:DownloadableFile {id: $id})
          SET target.permanentlyRemoved = true,
              target.permanentlyRemovedAt = datetime($removedAt)
          WITH target
          OPTIONAL MATCH (removerUser:User {username: $username})
          FOREACH (_ IN CASE WHEN removerUser IS NULL THEN [] ELSE [1] END |
            MERGE (removerUser)-[:REMOVED_DOWNLOADABLE_FILE]->(target)
          )
          WITH target
          OPTIONAL MATCH (removerMod:ModerationProfile {displayName: $modProfileName})
          FOREACH (_ IN CASE WHEN removerMod IS NULL THEN [] ELSE [1] END |
            MERGE (removerMod)-[:REMOVED_DOWNLOADABLE_FILE]->(target)
          )
          RETURN
            target.id AS id,
            target.fileName AS fileName,
            target.kind AS kind,
            target.size AS size,
            target.url AS url,
            target.storageBucket AS storageBucket,
            target.storageObjectName AS storageObjectName,
            target.storageUrl AS storageUrl,
            target.permanentlyRemoved AS permanentlyRemoved,
            toString(target.permanentlyRemovedAt) AS permanentlyRemovedAt
          `,
      {
        id,
        removedAt,
        username,
        modProfileName: modProfileName || null,
      }
    );

    const record = result.records[0];
    if (!record) {
      throw new GraphQLError("Upload not found");
    }

    return Object.fromEntries(record.keys.map((key) => [key, record.get(key)]));
  } finally {
    await session.close();
  }
};

const getResolver = ({
  driver,
  mediaType,
  deleteObject = deleteStoredObject,
  checkServerModPermission = hasServerModPermission,
}: PermanentlyDeleteStoredUploadInput) => {
  return async (
    parent: unknown,
    args: Args,
    context: GraphQLContext
  ): Promise<Record<string, unknown> & { storageDeletion: StorageDeletionResult }> => {
    const id = getTargetId(mediaType, args);
    const target = await readStoredUploadTarget({ driver, mediaType, id });

    if (!target) {
      throw new GraphQLError(
        mediaType === "Image" ? "Image not found" : "Downloadable file not found"
      );
    }

    if (target.permanentlyRemoved) {
      throw new GraphQLError("Upload has already been permanently deleted");
    }

    await assertCanDelete({
      context,
      target,
      checkServerModPermission,
    });

    const storageDeletion = await deleteObject({
      storageBucket: target.storageBucket,
      storageObjectName: target.storageObjectName,
    });

    const username = context.user?.username || "";
    const modProfileName = context.user?.data?.ModerationProfile?.displayName || null;
    const removed = await markStoredUploadRemoved({
      driver,
      mediaType,
      id,
      username,
      modProfileName,
    });

    return {
      ...removed,
      storageDeletion,
    };
  };
};

export default getResolver;
