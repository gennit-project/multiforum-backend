import { Storage } from "@google-cloud/storage";
import dotenv from "dotenv";
import neo4j from "neo4j-driver";
import { buildStorageUrl } from "../services/uploadStorageMetadata.js";

dotenv.config();

const apply = process.argv.includes("--apply");
const uri = process.env.NEO4J_URI || "bolt://localhost:7687";
const user = process.env.NEO4J_USER || "neo4j";
const password = process.env.NEO4J_PASSWORD;
const targetBucket = process.env.GCS_PRIVATE_DOWNLOAD_BUCKET_NAME;

if (!password) {
  throw new Error("NEO4J_PASSWORD is required to migrate downloads");
}
if (!targetBucket) {
  throw new Error("GCS_PRIVATE_DOWNLOAD_BUCKET_NAME is required to migrate downloads");
}

const credentials = process.env.GOOGLE_CREDENTIALS_BASE64
  ? JSON.parse(
      Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, "base64").toString("utf8")
    )
  : undefined;
const storage = new Storage(credentials ? { credentials } : undefined);
const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));

type DownloadRecord = {
  id: string;
  storageBucket: string;
  storageObjectName: string;
};

const loadDownloadsToMigrate = async (): Promise<DownloadRecord[]> => {
  const session = driver.session({ defaultAccessMode: "READ" });
  try {
    const result = await session.run(
      `
      MATCH (file:DownloadableFile)
      WHERE file.storageBucket IS NOT NULL
        AND file.storageObjectName IS NOT NULL
        AND file.storageBucket <> $targetBucket
      RETURN
        file.id AS id,
        file.storageBucket AS storageBucket,
        file.storageObjectName AS storageObjectName
      ORDER BY file.id
      `,
      { targetBucket }
    );

    return result.records.map((record) => ({
      id: record.get("id"),
      storageBucket: record.get("storageBucket"),
      storageObjectName: record.get("storageObjectName"),
    }));
  } finally {
    await session.close();
  }
};

const updateDownloadMetadata = async (download: DownloadRecord): Promise<void> => {
  const storageUrl = buildStorageUrl({
    storageBucket: targetBucket,
    storageObjectName: download.storageObjectName,
  });
  const session = driver.session({ defaultAccessMode: "WRITE" });
  try {
    const result = await session.run(
      `
      MATCH (file:DownloadableFile {id: $id})
      WHERE file.storageBucket = $sourceBucket
        AND file.storageObjectName = $storageObjectName
      SET
        file.storageBucket = $targetBucket,
        file.storageUrl = $storageUrl,
        file.url = $storageUrl
      WITH file
      OPTIONAL MATCH (audit:UploadedFileAudit {
        claimedByType: 'DownloadableFile',
        claimedById: $id
      })
      SET
        audit.storageBucket = $targetBucket,
        audit.storageUrl = $storageUrl
      RETURN count(DISTINCT file) AS updated
      `,
      {
        id: download.id,
        sourceBucket: download.storageBucket,
        storageObjectName: download.storageObjectName,
        targetBucket,
        storageUrl,
      }
    );

    if (result.records[0]?.get("updated").toNumber() !== 1) {
      throw new Error(`Download ${download.id} changed while it was being migrated`);
    }
  } finally {
    await session.close();
  }
};

const migrateDownload = async (download: DownloadRecord): Promise<void> => {
  const source = storage
    .bucket(download.storageBucket)
    .file(download.storageObjectName);
  const destination = storage
    .bucket(targetBucket)
    .file(download.storageObjectName);
  const [destinationExists] = await destination.exists();

  if (!destinationExists) {
    await source.copy(destination);
  }

  // Remove the publicly-addressable source before switching database metadata.
  // If the database update fails, rerunning is safe because the destination is
  // retained and source deletion ignores a missing object.
  await source.delete({ ignoreNotFound: true });
  await updateDownloadMetadata(download);
};

const run = async (): Promise<void> => {
  const downloads = await loadDownloadsToMigrate();
  console.log(`${apply ? "Migrating" : "Would migrate"} ${downloads.length} downloads`);

  if (!apply) {
    for (const download of downloads) {
      console.log(
        `${download.id}: gs://${download.storageBucket}/${download.storageObjectName} -> gs://${targetBucket}/${download.storageObjectName}`
      );
    }
    console.log("Dry run only. Re-run with --apply during a maintenance window.");
    return;
  }

  for (const download of downloads) {
    await migrateDownload(download);
    console.log(`Migrated ${download.id}`);
  }
};

run()
  .then(async () => {
    await driver.close();
    console.log("Private download migration complete");
  })
  .catch(async (error) => {
    await driver.close();
    console.error("Private download migration failed", error);
    process.exitCode = 1;
  });
