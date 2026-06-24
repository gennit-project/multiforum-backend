import { Storage, GetSignedUrlConfig } from "@google-cloud/storage";
import type { Ogm } from "../../types/context.js";

type Args = {
  filename: string;
  contentType: string;
  channelConnections?: string[]; // Optional array of channel names
};

interface ValidationContext {
  ogm: Ogm;
}

type ChannelUploadPreferences = {
  uniqueName?: string | null;
  imageUploadsEnabled?: boolean | null;
  allowedFileTypes?: string[] | null;
};

const isUrlEncoded = (filename: string): boolean => {
  try {
    return filename === encodeURIComponent(decodeURIComponent(filename));
  } catch (e) {
    return false;
  }
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
    console.error("Error validating file type:", error);
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
  return async (parent: unknown, args: Args, ctx: ValidationContext) => {
    let { filename, contentType, channelConnections = [] } = args;

    if (!isUrlEncoded(filename)) {
      throw new Error("Filename is not properly URL encoded");
    }

    // Validate file against server and channel configurations
    await validateFile(filename, contentType, channelConnections, ctx);

    const storage = new Storage();
    const bucketName = process.env.GCS_BUCKET_NAME;

    if (!bucketName) {
      throw new Error("GCS_BUCKET_NAME environment variable not set");
    }

    const options: GetSignedUrlConfig = {
      version: "v4",
      action: "write",
      expires: Date.now() + 15 * 60 * 1000, // 15 minutes
      contentType,
    };

    // Generate the Signed URL
    const [url] = await storage
      .bucket(bucketName)
      .file(filename)
      .getSignedUrl(options);

    if (!url) {
      console.error("No URL returned from getSignedUrl method");
      return { url: "" };
    }

    // Return the Signed URL
    return { url };
  };
};

export default createSignedStorageURL;
