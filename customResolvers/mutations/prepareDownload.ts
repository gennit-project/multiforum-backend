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
  })
) => {
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

    const runs = await triggerRuns({
      downloadableFileId,
      event: "downloadableFile.downloaded",
      models: input,
    }) as PluginRunRecord[];
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

    const scannedFile = await selectFile(input.DownloadableFile, downloadableFileId);
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
