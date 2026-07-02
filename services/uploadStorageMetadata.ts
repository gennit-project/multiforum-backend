import { randomUUID } from "node:crypto";
import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../types/context.js";

export type StorageUploadMetadata = {
  storageBucket: string;
  storageObjectName: string;
  storageUrl: string;
  uploadedAt: string;
  uploadedByUsername: string;
  uploadedByIp: string | null;
};

type BuildStorageObjectNameInput = {
  username: string;
  originalFilename: string;
  now?: Date;
  id?: string;
};

type CreateUploadAuditInput = StorageUploadMetadata & {
  driver: Driver;
  originalFilename: string;
  contentType: string;
};

type ClaimUploadAuditInput = {
  driver: Driver;
  storageObjectName?: string | null;
  username: string;
  claimedByType: "Image" | "DownloadableFile";
  claimedById: string;
};

type GetUploadAuditMetadataInput = {
  driver: Driver;
  storageObjectName?: string | null;
  username: string;
};

const sanitizePathSegment = (value: string): string => {
  const sanitized = value
    .trim()
    .replace(/[/\\]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return sanitized || "upload";
};

const safelyDecodeURIComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const getRequesterIp = (context: Pick<GraphQLContext, "req">): string | null => {
  const forwardedFor = context.req?.headers?.["x-forwarded-for"];
  const firstForwardedIp = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : forwardedFor?.split(",")[0];

  return (
    firstForwardedIp?.trim() ||
    context.req?.ip ||
    context.req?.socket?.remoteAddress ||
    null
  );
};

export const buildStorageObjectName = ({
  username,
  originalFilename,
  now = new Date(),
  id = randomUUID(),
}: BuildStorageObjectNameInput): string => {
  const safeUsername = sanitizePathSegment(username);
  const safeFilename = sanitizePathSegment(safelyDecodeURIComponent(originalFilename));
  const timestamp = now.toISOString().replace(/[:.]/g, "-");

  return `uploads/${safeUsername}/${timestamp}-${id}-${safeFilename}`;
};

export const buildStorageUrl = ({
  storageBucket,
  storageObjectName,
}: {
  storageBucket: string;
  storageObjectName: string;
}): string => {
  const encodedObjectName = storageObjectName
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `https://storage.googleapis.com/${encodeURIComponent(storageBucket)}/${encodedObjectName}`;
};

export const createUploadAuditRecord = async ({
  driver,
  storageBucket,
  storageObjectName,
  storageUrl,
  originalFilename,
  contentType,
  uploadedAt,
  uploadedByUsername,
  uploadedByIp,
}: CreateUploadAuditInput): Promise<void> => {
  const session = driver.session({ defaultAccessMode: "WRITE" });

  try {
    await session.run(
      `
      CREATE (:UploadedFileAudit {
        id: randomUUID(),
        storageBucket: $storageBucket,
        storageObjectName: $storageObjectName,
        storageUrl: $storageUrl,
        originalFilename: $originalFilename,
        contentType: $contentType,
        uploadedAt: datetime($uploadedAt),
        uploadedByUsername: $uploadedByUsername,
        uploadedByIp: $uploadedByIp
      })
      `,
      {
        storageBucket,
        storageObjectName,
        storageUrl,
        originalFilename,
        contentType,
        uploadedAt,
        uploadedByUsername,
        uploadedByIp,
      }
    );
  } finally {
    await session.close();
  }
};

export const getUnclaimedUploadAuditMetadata = async ({
  driver,
  storageObjectName,
  username,
}: GetUploadAuditMetadataInput): Promise<StorageUploadMetadata | null> => {
  if (!storageObjectName) {
    return null;
  }

  const session = driver.session({ defaultAccessMode: "READ" });

  try {
    const result = await session.run(
      `
      MATCH (audit:UploadedFileAudit {
        storageObjectName: $storageObjectName,
        uploadedByUsername: $username
      })
      WHERE audit.claimedAt IS NULL
      RETURN
        audit.storageBucket AS storageBucket,
        audit.storageObjectName AS storageObjectName,
        audit.storageUrl AS storageUrl,
        toString(audit.uploadedAt) AS uploadedAt,
        audit.uploadedByUsername AS uploadedByUsername,
        audit.uploadedByIp AS uploadedByIp
      `,
      {
        storageObjectName,
        username,
      }
    );

    const record = result.records[0];
    if (!record) {
      return null;
    }

    return {
      storageBucket: record.get("storageBucket"),
      storageObjectName: record.get("storageObjectName"),
      storageUrl: record.get("storageUrl"),
      uploadedAt: record.get("uploadedAt"),
      uploadedByUsername: record.get("uploadedByUsername"),
      uploadedByIp: record.get("uploadedByIp"),
    };
  } finally {
    await session.close();
  }
};

export const claimUploadAuditMetadata = async ({
  driver,
  storageObjectName,
  username,
  claimedByType,
  claimedById,
}: ClaimUploadAuditInput): Promise<StorageUploadMetadata | null> => {
  if (!storageObjectName) {
    return null;
  }

  const session = driver.session({ defaultAccessMode: "WRITE" });

  try {
    const result = await session.run(
      `
      MATCH (audit:UploadedFileAudit {
        storageObjectName: $storageObjectName,
        uploadedByUsername: $username
      })
      WHERE audit.claimedAt IS NULL
      SET
        audit.claimedAt = datetime($claimedAt),
        audit.claimedByType = $claimedByType,
        audit.claimedById = $claimedById
      RETURN
        audit.storageBucket AS storageBucket,
        audit.storageObjectName AS storageObjectName,
        audit.storageUrl AS storageUrl,
        toString(audit.uploadedAt) AS uploadedAt,
        audit.uploadedByUsername AS uploadedByUsername,
        audit.uploadedByIp AS uploadedByIp
      `,
      {
        storageObjectName,
        username,
        claimedAt: new Date().toISOString(),
        claimedByType,
        claimedById,
      }
    );

    const record = result.records[0];
    if (!record) {
      return null;
    }

    return {
      storageBucket: record.get("storageBucket"),
      storageObjectName: record.get("storageObjectName"),
      storageUrl: record.get("storageUrl"),
      uploadedAt: record.get("uploadedAt"),
      uploadedByUsername: record.get("uploadedByUsername"),
      uploadedByIp: record.get("uploadedByIp"),
    };
  } finally {
    await session.close();
  }
};
