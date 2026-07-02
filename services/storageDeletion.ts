import { Storage } from "@google-cloud/storage";

export type StoredObjectMetadata = {
  storageBucket?: string | null;
  storageObjectName?: string | null;
};

export type StorageDeletionStatus = "deleted" | "skipped";

export type StorageDeletionResult = {
  status: StorageDeletionStatus;
  storageBucket?: string;
  storageObjectName?: string;
  reason?: "missing-storage-metadata";
};

export type StorageFileClient = {
  delete: (options?: { ignoreNotFound?: boolean }) => Promise<unknown>;
};

export type StorageBucketClient = {
  file: (storageObjectName: string) => StorageFileClient;
};

export type StorageClient = {
  bucket: (storageBucket: string) => StorageBucketClient;
};

type DeleteStoredObjectInput = StoredObjectMetadata & {
  storage?: StorageClient;
};

export const deleteStoredObject = async ({
  storageBucket,
  storageObjectName,
  storage,
}: DeleteStoredObjectInput): Promise<StorageDeletionResult> => {
  if (!storageBucket || !storageObjectName) {
    return {
      status: "skipped",
      reason: "missing-storage-metadata",
      storageBucket: storageBucket || undefined,
      storageObjectName: storageObjectName || undefined,
    };
  }

  const storageClient = storage || new Storage();
  await storageClient
    .bucket(storageBucket)
    .file(storageObjectName)
    .delete({ ignoreNotFound: true });

  return {
    status: "deleted",
    storageBucket,
    storageObjectName,
  };
};
