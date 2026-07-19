import type {
  DownloadableFileModel,
  PluginModel,
  PluginRunModel,
  PluginVersionModel,
  ServerConfigModel,
  ServerSecretModel,
} from "../../ogm_types.js";
import type { GraphQLContext } from "../../types/context.js";
import { hasServerModPermission } from "../../rules/permission/hasServerModPermission.js";
import { triggerPluginRunsForDownloadableFile } from "../../services/pluginRunner.js";

type Input = {
  DownloadableFile: DownloadableFileModel;
  Plugin: PluginModel;
  PluginVersion: PluginVersionModel;
  PluginRun: PluginRunModel;
  ServerConfig: ServerConfigModel;
  ServerSecret: ServerSecretModel;
};

type FileRecord = {
  uploadedByUsername?: string | null;
  scanStatus?: string | null;
  Discussion?: { Author?: { username?: string | null } | null } | null;
};

export const createRetryDownloadableFileScanResolver = (
  input: Input,
  checkServerModPermission: typeof hasServerModPermission = hasServerModPermission,
  triggerRuns: typeof triggerPluginRunsForDownloadableFile = triggerPluginRunsForDownloadableFile
) => {
  return async (
    _parent: unknown,
    { downloadableFileId }: { downloadableFileId: string },
    context: GraphQLContext
  ) => {
    const files = await input.DownloadableFile.find({
      where: { id: downloadableFileId },
      selectionSet: `{
        uploadedByUsername
        scanStatus
        Discussion { Author { username } }
      }`,
    }) as FileRecord[];
    const file = files[0];

    if (!file) throw new Error("Downloadable file not found");
    if (file.scanStatus === "CLEAN") {
      throw new Error("A clean downloadable file does not need another scan");
    }

    const username = context.user?.username;
    const isCreator = Boolean(username) && (
      file.uploadedByUsername === username ||
      file.Discussion?.Author?.username === username
    );
    if (!isCreator) {
      const canReview = await checkServerModPermission(
        "canPermanentlyRemoveImage",
        context
      );
      if (canReview !== true) throw new Error("Not authorized to retry this scan");
    }

    return triggerRuns({
      downloadableFileId,
      event: "downloadableFile.updated",
      models: input,
    });
  };
};

export default createRetryDownloadableFileScanResolver;
