import { Storage, type GetSignedUrlConfig } from "@google-cloud/storage";

export const DOWNLOAD_READ_URL_TTL_MS = 5 * 60 * 1000;

export type StoredDownloadFile = {
  url?: string | null;
  storageBucket?: string | null;
  storageObjectName?: string | null;
};

type StorageClient = Pick<Storage, "bucket">;

export const createDownloadReadUrl = async ({
  file,
  storage = new Storage(),
  now = Date.now,
}: {
  file: StoredDownloadFile;
  storage?: StorageClient;
  now?: () => number;
}): Promise<string> => {
  if (!file.storageBucket || !file.storageObjectName) {
    return file.url || "";
  }

  const options: GetSignedUrlConfig = {
    version: "v4",
    action: "read",
    expires: now() + DOWNLOAD_READ_URL_TTL_MS,
    responseDisposition: "attachment",
  };
  const [url] = await storage
    .bucket(file.storageBucket)
    .file(file.storageObjectName)
    .getSignedUrl(options);

  return url || "";
};
