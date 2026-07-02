import assert from "node:assert/strict";
import test from "node:test";
import {
  deleteStoredObject,
  type StorageClient,
} from "./storageDeletion.js";

const buildStorageClient = () => {
  const calls = {
    bucket: [] as string[],
    file: [] as string[],
    delete: [] as Array<{ ignoreNotFound?: boolean } | undefined>,
  };

  const storage: StorageClient = {
    bucket: (storageBucket: string) => {
      calls.bucket.push(storageBucket);
      return {
        file: (storageObjectName: string) => {
          calls.file.push(storageObjectName);
          return {
            delete: async (options?: { ignoreNotFound?: boolean }) => {
              calls.delete.push(options);
            },
          };
        },
      };
    },
  };

  return { storage, calls };
};

test("deleteStoredObject deletes the stored object and ignores missing GCS objects", async () => {
  const { storage, calls } = buildStorageClient();

  const result = await deleteStoredObject({
    storageBucket: "bucket",
    storageObjectName: "uploads/alice/file.stl",
    storage,
  });

  assert.deepEqual(
    {
      result,
      calls,
    },
    {
      result: {
        status: "deleted",
        storageBucket: "bucket",
        storageObjectName: "uploads/alice/file.stl",
      },
      calls: {
        bucket: ["bucket"],
        file: ["uploads/alice/file.stl"],
        delete: [{ ignoreNotFound: true }],
      },
    }
  );
});

test("deleteStoredObject skips deletion when storage metadata is missing", async () => {
  const { storage, calls } = buildStorageClient();

  const result = await deleteStoredObject({
    storageBucket: "bucket",
    storageObjectName: null,
    storage,
  });

  assert.deepEqual(
    {
      result,
      calls,
    },
    {
      result: {
        status: "skipped",
        reason: "missing-storage-metadata",
        storageBucket: "bucket",
        storageObjectName: undefined,
      },
      calls: {
        bucket: [],
        file: [],
        delete: [],
      },
    }
  );
});

test("deleteStoredObject propagates storage client errors", async () => {
  const storage: StorageClient = {
    bucket: () => ({
      file: () => ({
        delete: async () => {
          throw new Error("storage unavailable");
        },
      }),
    }),
  };

  await assert.rejects(
    deleteStoredObject({
      storageBucket: "bucket",
      storageObjectName: "uploads/alice/file.stl",
      storage,
    }),
    /storage unavailable/
  );
});
