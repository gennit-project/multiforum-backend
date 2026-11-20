import { rememberCanonicalSource } from "../../services/canonicalSourceFields.js";
import { Storage, GetSignedUrlConfig } from "@google-cloud/storage";
import type { Driver } from "neo4j-driver";
import type { GraphQLContext } from "../../types/context.js";
import { logger } from "../../logger.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import {
  buildStorageObjectName,
  buildStorageUrl,
  createUploadAuditRecord,
  getRequesterIp,
} from "../../services/uploadStorageMetadata.js";
import {
  resolveContentFeaturePolicyRepository,
  type ContentFeaturePolicyRepository,
} from "../../services/persistence/contentFeaturePolicyRepository.js";

type Args = {
  filename: string;
  contentType: string;
  channelConnections?: string[] | null; // Optional array of channel names
  uploadTarget?: "PUBLIC_MEDIA" | "PRIVATE_DOWNLOAD" | null;
};

interface ValidationContext {
  driver: Driver;
  contentFeaturePolicyRepository?: ContentFeaturePolicyRepository;
}

type ResolverContext = ValidationContext & Pick<GraphQLContext, "req" | "user">;

/**
 * Validate file type against ServerConfig and Channel allowed file types
 */
export const validateFileType = async (
  filename: string,
  channelConnections: string[] | null = [],
  ctx: ValidationContext
): Promise<void> => {
  // Extract file extension
  const fileExtension = filename.split('.').pop()?.toLowerCase();
  if (!fileExtension) {
    throw new Error("File must have a valid extension");
  }

  const repository = resolveContentFeaturePolicyRepository(ctx);

  try {
    // Get server-wide allowed file types
    const serverConfig = await repository.findServerFileTypePolicy();
    const serverAllowedFileTypes = serverConfig.allowedFileTypes;

    // Check if file type is allowed server-wide
    // Handle both formats: with dot (.stl) and without dot (stl)
    const isAllowedByServer = serverAllowedFileTypes.length === 0 || 
      serverAllowedFileTypes.includes(fileExtension) || 
      serverAllowedFileTypes.includes(`.${fileExtension}`);
      
    if (!isAllowedByServer) {
      throw new Error(
        `File type '${fileExtension}' is not allowed by server configuration. Allowed types: ${serverAllowedFileTypes.join(', ')}`
      );
    }

    // If there are channel connections, check each channel's allowed file types
    if (channelConnections === null) throw new TypeError("Cannot read properties of null (reading 'length')");
    if (channelConnections.length > 0) {
      for (const channelName of channelConnections) {
        const channel = await repository.findChannelPolicy(channelName);
        if (!channel.found) {
          throw new Error(`Channel '${channelName}' not found`);
        }

        const channelAllowedFileTypes = channel.allowedFileTypes || [];
        
        // Check if file type is allowed in this channel
        // Handle both formats: with dot (.stl) and without dot (stl)
        const isAllowedByChannel = channelAllowedFileTypes.length === 0 || 
          channelAllowedFileTypes.includes(fileExtension) || 
          channelAllowedFileTypes.includes(`.${fileExtension}`);
          
        if (!isAllowedByChannel) {
          throw new Error(
            `File type '${fileExtension}' is not allowed in channel '${channelName}'. Allowed types: ${channelAllowedFileTypes.join(', ')}`
          );
        }
      }
    }
  } catch (error) {
    // If it's already a validation error, re-throw it
    if (error instanceof Error) {
      throw error;
    }
    logger.error("Error validating file type:", error);
    throw new Error("Failed to validate file type permissions");
  }
};

export const validateImageUploadsEnabled = async (
  channelConnections: string[] | null = [],
  ctx: ValidationContext
): Promise<void> => {
  if (channelConnections === null) throw new TypeError("Cannot read properties of null (reading 'length')");
  if (channelConnections.length === 0) {
    return;
  }

  const repository = resolveContentFeaturePolicyRepository(ctx);

  for (const channelName of channelConnections) {
    const channel = await repository.findChannelPolicy(channelName);

    if (!channel.found) {
      throw new Error(`Channel '${channelName}' not found`);
    }

    if (channel.imageUploadsEnabled === false) {
      throw new Error(`Image uploads are disabled in channel '${channelName}'.`);
    }
  }
};

export const validateFile = async (
  filename: string,
  contentType: string,
  channelConnections: string[] | null = [],
  ctx: ValidationContext
): Promise<void> => {
  if (contentType.toLowerCase().startsWith("image/")) {
    await validateImageUploadsEnabled(channelConnections, ctx);
    return;
  }

  // Validate file type against server and channel configurations
  await validateFileType(filename, channelConnections, ctx);
};

// Fallback ceilings (bytes) used only when neither the channel override nor the
// ServerConfig default is set. 10 MiB for images, 100 MiB for other files.
export const DEFAULT_IMAGE_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const DEFAULT_FILE_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export const isImageContentType = (contentType: string): boolean =>
  contentType.toLowerCase().startsWith("image/");

/**
 * Resolve the effective upload size ceiling (in bytes) for this request.
 *
 * Precedence per channel: channel override -> ServerConfig default -> hard
 * fallback. When several channels are targeted, the most restrictive (minimum)
 * limit wins. The returned value is signed into the upload URL as an
 * x-goog-content-length-range header so GCS itself rejects oversized objects.
 */
export const resolveMaxUploadBytes = async (
  contentType: string,
  channelConnections: string[] | null = [],
  ctx: ValidationContext
): Promise<number> => {
  const repository = resolveContentFeaturePolicyRepository(ctx);
  const image = isImageContentType(contentType);
  const hardDefault = image
    ? DEFAULT_IMAGE_MAX_UPLOAD_BYTES
    : DEFAULT_FILE_MAX_UPLOAD_BYTES;

  const serverConfig = await repository.findServerFileTypePolicy();
  const serverLimit = image
    ? serverConfig.imageMaxUploadBytes
    : serverConfig.fileMaxUploadBytes;
  const serverEffective = positiveOrNull(serverLimit) ?? hardDefault;

  const channels = channelConnections ?? [];
  if (channels.length === 0) {
    return serverEffective;
  }

  let effective = Number.POSITIVE_INFINITY;
  for (const channelName of channels) {
    const channel = await repository.findChannelPolicy(channelName);
    const channelOverride = channel.found
      ? positiveOrNull(
          image ? channel.imageMaxUploadBytes : channel.fileMaxUploadBytes
        )
      : null;
    effective = Math.min(effective, channelOverride ?? serverEffective);
  }

  return Number.isFinite(effective) ? effective : serverEffective;
};

const positiveOrNull = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;

export const resolveUploadBucketName = ({
  uploadTarget,
  env = process.env,
}: {
  uploadTarget?: Args["uploadTarget"];
  env?: Partial<
    Pick<NodeJS.ProcessEnv, "GCS_BUCKET_NAME" | "GCS_PRIVATE_DOWNLOAD_BUCKET_NAME">
  >;
}): string => {
  const environmentVariable = uploadTarget === "PRIVATE_DOWNLOAD"
    ? "GCS_PRIVATE_DOWNLOAD_BUCKET_NAME"
    : "GCS_BUCKET_NAME";
  const bucketName = env[environmentVariable];

  if (!bucketName) {
    throw new Error(`${environmentVariable} environment variable not set`);
  }

  return bucketName;
};

type SignUploadUrl = (storage: Storage, bucketName: string, objectName: string, options: GetSignedUrlConfig) => Promise<[string]>;
const signUploadUrl: SignUploadUrl = (storage, bucketName, objectName, options) =>
  storage.bucket(bucketName).file(objectName).getSignedUrl(options);

// The optional signer is a test seam; the default retains the same storage call.
const createSignedStorageURL = ({ signUrl = signUploadUrl }: { signUrl?: SignUploadUrl } = {}) => {
  return async (parent: unknown, args: Args, ctx: ResolverContext) => {
    const {
      filename,
      contentType,
      channelConnections = [],
      uploadTarget,
    } = args;

    if (!filename?.trim()) {
      throw new Error("Filename is required");
    }

    ctx.user = await setUserDataOnContext({ context: ctx });
    const username = ctx.user?.username;

    if (!username) {
      throw new Error("You must be logged in to upload files");
    }

    // Validate file against server and channel configurations
    await validateFile(filename, contentType, channelConnections, ctx);

    // Resolve the size ceiling so GCS can reject oversized uploads directly.
    const maxUploadBytes = await resolveMaxUploadBytes(
      contentType,
      channelConnections,
      ctx
    );

    const storage = new Storage();
    const bucketName = resolveUploadBucketName({ uploadTarget });

    const uploadedAt = new Date().toISOString();
    const storageObjectName = buildStorageObjectName({
      username,
      originalFilename: filename,
    });
    const storageUrl = buildStorageUrl({
      storageBucket: bucketName,
      storageObjectName,
    });

    const options: GetSignedUrlConfig = {
      version: "v4",
      action: "write",
      expires: Date.now() + 15 * 60 * 1000, // 15 minutes
      contentType,
      // Signed into the URL: the client must replay this exact header on the
      // PUT, and GCS rejects any object whose size falls outside the range.
      extensionHeaders: {
        "x-goog-content-length-range": `0,${maxUploadBytes}`,
      },
    };

    // Generate the Signed URL
    const [url] = await signUrl(storage, bucketName, storageObjectName, options);

    if (!url) {
      logger.error("No URL returned from getSignedUrl method");
      return rememberCanonicalSource({ url: "" });
    }

    await createUploadAuditRecord({
      driver: ctx.driver,
      storageBucket: bucketName,
      storageObjectName,
      storageUrl,
      originalFilename: filename,
      contentType,
      uploadedAt,
      uploadedByUsername: username,
      uploadedByIp: getRequesterIp(ctx),
    });

    // Return the Signed URL
    return rememberCanonicalSource({
      url,
      storageBucket: bucketName,
      storageObjectName,
      storageUrl,
      uploadedAt,
    });
  };
};

export default createSignedStorageURL;
