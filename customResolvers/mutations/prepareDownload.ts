import { Storage, type GetSignedUrlConfig } from "@google-cloud/storage";
import type { Driver } from "neo4j-driver";
import type {
  DownloadableFileModel,
  PluginModel,
  PluginRunModel,
  PluginVersionModel,
  ServerConfigModel,
  ServerSecretModel,
} from "../../ogm_types.js";
import { hasServerModPermission } from "../../rules/permission/hasServerModPermission.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import { SECURITY_SCAN_PLUGIN_ID } from "../../services/plugin/downloadScanOutcome.js";
import { triggerPluginRunsForDownloadableFile } from "../../services/pluginRunner.js";
import type { GraphQLContext } from "../../types/context.js";
import trackDownload from "./trackDownload.js";

type Input = {
  DownloadableFile: DownloadableFileModel;
  Plugin: PluginModel;
  PluginVersion: PluginVersionModel;
  PluginRun: PluginRunModel;
  ServerConfig: ServerConfigModel;
  ServerSecret: ServerSecretModel;
  driver: Driver;
};

type FileRecord = {
  id: string;
  url?: string | null;
  storageBucket?: string | null;
  storageObjectName?: string | null;
  scanStatus?: string | null;
  scanReason?: string | null;
  scanCheckedAt?: string | null;
  uploadedByUsername?: string | null;
  Discussion?: {
    id?: string | null;
    Author?: { username?: string | null } | null;
  } | null;
};

type PluginRunRecord = {
  pluginId?: string | null;
  status?: string | null;
};

type TrackDownloadResolver = ReturnType<typeof trackDownload>;

type StorageFactory = () => Pick<Storage, "bucket">;

const READ_URL_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_DOWNLOAD_SCAN_CACHE_TTL_MS = 15 * 60 * 1000;

type PrepareDownloadOptions = {
  now?: () => Date;
  scanCacheTtlMs?: number;
};

const configuredScanCacheTtlMs = (): number => {
  const configured = Number(process.env.DOWNLOAD_SCAN_CACHE_TTL_MS);
  return Number.isFinite(configured) && configured >= 0
    ? configured
    : DEFAULT_DOWNLOAD_SCAN_CACHE_TTL_MS;
};

const hasFreshCleanScan = ({
  file,
  now,
  ttlMs,
}: {
  file: FileRecord;
  now: Date;
  ttlMs: number;
}): boolean => {
  if (file.scanStatus !== "CLEAN" || !file.scanCheckedAt || ttlMs <= 0) {
    return false;
  }

  const checkedAt = Date.parse(file.scanCheckedAt);
  const ageMs = now.getTime() - checkedAt;
  return Number.isFinite(checkedAt) && ageMs >= 0 && ageMs <= ttlMs;
};

const selectFile = async (
  DownloadableFile: DownloadableFileModel,
  downloadableFileId: string
): Promise<FileRecord | null> => {
  const files = await DownloadableFile.find({
    where: { id: downloadableFileId },
    selectionSet: `{
      id
      url
      storageBucket
      storageObjectName
      scanStatus
      scanReason
      scanCheckedAt
      uploadedByUsername
      Discussion { id Author { username } }
    }`,
  }) as FileRecord[];

  return files[0] || null;
};

const createReadUrl = async ({
  file,
  storageFactory,
}: {
  file: FileRecord;
  storageFactory: StorageFactory;
}): Promise<string> => {
  if (!file.storageBucket || !file.storageObjectName) {
    return file.url || "";
  }

  const options: GetSignedUrlConfig = {
    version: "v4",
    action: "read",
    expires: Date.now() + READ_URL_TTL_MS,
    responseDisposition: "attachment",
  };
  const [url] = await storageFactory()
    .bucket(file.storageBucket)
    .file(file.storageObjectName)
    .getSignedUrl(options);

  return url || "";
};

export const createPrepareDownloadResolver = (
  input: Input,
  triggerRuns: typeof triggerPluginRunsForDownloadableFile =
    triggerPluginRunsForDownloadableFile,
  checkServerModPermission: typeof hasServerModPermission =
    hasServerModPermission,
  storageFactory: StorageFactory = () => new Storage(),
  trackDownloadResolver: TrackDownloadResolver = trackDownload({
    driver: input.driver,
  }),
  {
    now = () => new Date(),
    scanCacheTtlMs = configuredScanCacheTtlMs(),
  }: PrepareDownloadOptions = {}
) => {
  const inFlightScans = new Map<string, Promise<PluginRunRecord[]>>();

  const runOrJoinScan = (downloadableFileId: string) => {
    const existingScan = inFlightScans.get(downloadableFileId);
    if (existingScan) return existingScan;

    const scan = Promise.resolve(triggerRuns({
      downloadableFileId,
      event: "downloadableFile.downloaded",
      models: input,
    }) as Promise<PluginRunRecord[]>).finally(() => {
      inFlightScans.delete(downloadableFileId);
    });
    inFlightScans.set(downloadableFileId, scan);
    return scan;
  };

  return async (
    _parent: unknown,
    {
      downloadableFileId,
      discussionId,
    }: { downloadableFileId: string; discussionId: string },
    context: GraphQLContext
  ) => {
    if (!downloadableFileId) throw new Error("Downloadable file ID is required");
    if (!discussionId) throw new Error("Discussion ID is required");

    if (!context.user) {
      context.user = await setUserDataOnContext({ context });
    }
    const username = context.user?.username;
    if (!username) throw new Error("You must be logged in to download files");

    const originalFile = await selectFile(input.DownloadableFile, downloadableFileId);
    if (!originalFile || originalFile.Discussion?.id !== discussionId) {
      throw new Error("Downloadable file not found for this discussion");
    }

    const isCreator =
      originalFile.uploadedByUsername === username ||
      originalFile.Discussion?.Author?.username === username;
    const canReview = isCreator || (await checkServerModPermission(
      "canPermanentlyRemoveImage",
      context
    )) === true;

    let scannedFile: FileRecord | null = originalFile;
    if (!hasFreshCleanScan({
      file: originalFile,
      now: now(),
      ttlMs: scanCacheTtlMs,
    })) {
      const runs = await runOrJoinScan(downloadableFileId);
      const securityRun = runs.find(
        (run) => run.pluginId === SECURITY_SCAN_PLUGIN_ID
      );

      if (!securityRun) {
        return {
          ready: false,
          url: null,
          scanStatus: "FAILED",
          scanReason: null,
          scanCheckedAt: null,
          reviewAccess: false,
          message: "The download security scanner is not configured.",
        };
      }

      scannedFile = await selectFile(input.DownloadableFile, downloadableFileId);
    }
    if (!scannedFile) throw new Error("Downloadable file no longer exists");

    const scanStatus = scannedFile.scanStatus || "FAILED";
    const reviewAccess = scanStatus !== "CLEAN" && canReview;
    const ready = scanStatus === "CLEAN" || reviewAccess;
    if (!ready) {
      return {
        ready: false,
        url: null,
        scanStatus,
        scanReason: null,
        scanCheckedAt: scannedFile.scanCheckedAt || null,
        reviewAccess: false,
        message: scanStatus === "FAILED"
          ? "The security check could not be completed. Please try again."
          : "This download was blocked by the security check.",
      };
    }

    const url = await createReadUrl({ file: scannedFile, storageFactory });
    if (!url) {
      return {
        ready: false,
        url: null,
        scanStatus: "FAILED",
        scanReason: null,
        scanCheckedAt: scannedFile.scanCheckedAt || null,
        reviewAccess: false,
        message: "The download URL could not be prepared. Please try again.",
      };
    }

    await trackDownloadResolver(
      null,
      { downloadableFileId, discussionId },
      context
    );

    return {
      ready: true,
      url,
      scanStatus,
      scanReason: reviewAccess ? scannedFile.scanReason || null : null,
      scanCheckedAt: scannedFile.scanCheckedAt || null,
      reviewAccess,
      message: reviewAccess
        ? "The file is still held for review. Reviewer download prepared."
        : "No threats found. Your download is ready.",
    };
  };
};

export default createPrepareDownloadResolver;
