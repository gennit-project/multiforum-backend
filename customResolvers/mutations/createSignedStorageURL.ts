import { Storage, GetSignedUrlConfig } from "@google-cloud/storage";
import type { Driver } from "neo4j-driver";
import type { GraphQLContext, Ogm } from "../../types/context.js";
import { logger } from "../../logger.js";
import { setUserDataOnContext } from "../../rules/permission/userDataHelperFunctions.js";
import {
  buildStorageObjectName,
  buildStorageUrl,
  createUploadAuditRecord,
  getRequesterIp,
} from "../../services/uploadStorageMetadata.js";

type Args = {
  filename: string;
  contentType: string;
  channelConnections?: string[]; // Optional array of channel names
};

interface ValidationContext {
  ogm: Ogm;
}

type ResolverContext = ValidationContext & {
  driver: Driver;
} & Pick<GraphQLContext, "req" | "user">;

type ChannelUploadPreferences = {
  uniqueName?: string | null;
  imageUploadsEnabled?: boolean | null;
  allowedFileTypes?: string[] | null;
};

/**
 * Validate file type against ServerConfig and Channel allowed file types
 */
export const validateFileType = async (
  filename: string,
  channelConnections: string[] = [],
  ctx: ValidationContext
): Promise<void> => {
  // Extract file extension
  const fileExtension = filename.split('.').pop()?.toLowerCase();
  if (!fileExtension) {
    throw new Error("File must have a valid extension");
  }

  const ServerConfigModel = ctx.ogm.model("ServerConfig");
  const ChannelModel = ctx.ogm.model("Channel");

  try {
    // Get server-wide allowed file types
    const serverConfigs = await ServerConfigModel.find({
      selectionSet: `{
        allowedFileTypes
      }`
    });

    const serverConfig = serverConfigs?.[0];
    const serverAllowedFileTypes = serverConfig?.allowedFileTypes || [];

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
    if (channelConnections.length > 0) {
      for (const channelName of channelConnections) {
        const channels = (await ChannelModel.find({
          where: { uniqueName: channelName },
          selectionSet: `{
            uniqueName
            allowedFileTypes
          }`
        })) as ChannelUploadPreferences[];

        const channel = channels?.[0];
        if (!channel) {
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
  channelConnections: string[] = [],
  ctx: ValidationContext
): Promise<void> => {
  if (channelConnections.length === 0) {
    return;
  }

  const ChannelModel = ctx.ogm.model("Channel");

  for (const channelName of channelConnections) {
    const channels = (await ChannelModel.find({
      where: { uniqueName: channelName },
      selectionSet: `{
        uniqueName
        imageUploadsEnabled
      }`
    })) as ChannelUploadPreferences[];
    const channel = channels?.[0];

    if (!channel) {
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
  channelConnections: string[] = [],
  ctx: ValidationContext
): Promise<void> => {
  if (contentType.toLowerCase().startsWith("image/")) {
    await validateImageUploadsEnabled(channelConnections, ctx);
    return;
  }

  // Validate file type against server and channel configurations
  await validateFileType(filename, channelConnections, ctx);
};

const createSignedStorageURL = () => {
  return async (parent: unknown, args: Args, ctx: ResolverContext) => {
    let { filename, contentType, channelConnections = [] } = args;

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

    const storage = new Storage();
    const bucketName = process.env.GCS_BUCKET_NAME;

    if (!bucketName) {
      throw new Error("GCS_BUCKET_NAME environment variable not set");
    }

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
    };

    // Generate the Signed URL
    const [url] = await storage
      .bucket(bucketName)
      .file(storageObjectName)
      .getSignedUrl(options);

    if (!url) {
      logger.error("No URL returned from getSignedUrl method");
      return { url: "" };
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
    return {
      url,
      storageBucket: bucketName,
      storageObjectName,
      storageUrl,
      uploadedAt,
    };
  };
};

export default createSignedStorageURL;
