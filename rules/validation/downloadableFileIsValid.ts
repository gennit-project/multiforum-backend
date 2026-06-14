import { rule } from "graphql-shield";
import {
  DownloadableFileCreateInput,
  DownloadableFileUpdateInput,
} from "../../src/generated/graphql.js";

interface ValidationContext {
  ogm: any;
  req: any;
}

type CreateDownloadableFileArgs = { 
  input: DownloadableFileCreateInput[] 
};

type UpdateDownloadableFileArgs = { 
  update: DownloadableFileUpdateInput;
  where: any;
};

type DownloadChannelPreference = {
  uniqueName?: string | null;
  downloadsEnabled?: boolean | null;
  allowedFileTypes?: string[] | null;
};

export const validateDownloadChannelsEnabled = async (
  channelConnections: string[] | undefined,
  ctx: ValidationContext
): Promise<true | string> => {
  if (!channelConnections?.length) {
    return true;
  }

  const ChannelModel = ctx.ogm.model("Channel");

  for (const channelName of channelConnections) {
    const channels = (await ChannelModel.find({
      where: { uniqueName: channelName },
      selectionSet: `{
        uniqueName
        downloadsEnabled
      }`,
    })) as DownloadChannelPreference[];
    const channel = channels?.[0];

    if (!channel) {
      return `Channel '${channelName}' not found`;
    }

    if (channel.downloadsEnabled === false) {
      return `Downloads are disabled in channel '${channelName}'.`;
    }
  }

  return true;
};

/**
 * Validate that the file type is allowed by both ServerConfig and all target channels
 */
export const validateFileTypePermissions = async (
  fileName: string,
  channelConnections: string[] | undefined,
  ctx: ValidationContext
): Promise<true | string> => {
  if (!fileName) {
    return true; // Skip validation if no filename provided (let other validations handle this)
  }

  // Extract file extension
  const fileExtension = fileName.split('.').pop()?.toLowerCase();
  if (!fileExtension) {
    return "File must have a valid extension";
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
      return `File type '${fileExtension}' is not allowed by server configuration. Allowed types: ${serverAllowedFileTypes.join(', ')}`;
    }

    // If there are channel connections, check each channel's allowed file types
    if (channelConnections && channelConnections.length > 0) {
      for (const channelName of channelConnections) {
        const channels = await ChannelModel.find({
          where: { uniqueName: channelName },
          selectionSet: `{
            uniqueName
            downloadsEnabled
            allowedFileTypes
          }`
        }) as DownloadChannelPreference[];

        const channel = channels?.[0];
        if (!channel) {
          return `Channel '${channelName}' not found`;
        }

        if (channel.downloadsEnabled === false) {
          return `Downloads are disabled in channel '${channelName}'.`;
        }

        const channelAllowedFileTypes = channel.allowedFileTypes || [];
        
        // Check if file type is allowed in this channel
        // Handle both formats: with dot (.stl) and without dot (stl)
        const isAllowedByChannel = channelAllowedFileTypes.length === 0 || 
          channelAllowedFileTypes.includes(fileExtension) || 
          channelAllowedFileTypes.includes(`.${fileExtension}`);
          
        if (!isAllowedByChannel) {
          return `File type '${fileExtension}' is not allowed in channel '${channelName}'. Allowed types: ${channelAllowedFileTypes.join(', ')}`;
        }
      }
    }

    return true;
  } catch (error) {
    console.error("Error validating file type permissions:", error);
    return "Failed to validate file type permissions";
  }
};

export const createDownloadableFileInputIsValid = rule({ cache: "contextual" })(
  async (parent: any, args: CreateDownloadableFileArgs, ctx: ValidationContext, info: any) => {
    if (!args.input || !args.input[0]) {
      return "Missing or empty input in args.";
    }

    const input = args.input[0];
    
    // For create operations, we need to check if there are any channel connections
    // This might come from a different part of the mutation args depending on your implementation
    // You may need to adjust this based on how your create mutation handles channel connections
    let channelConnections: string[] = [];
    
    // If your create mutation includes channel connections, extract them here
    // This is a placeholder - adjust based on your actual implementation
    if ((args as any).channelConnections) {
      channelConnections = (args as any).channelConnections;
    }

    const fileTypeValidation = await validateFileTypePermissions(
      input.fileName || "",
      channelConnections,
      ctx
    );

    if (fileTypeValidation !== true) {
      return fileTypeValidation;
    }

    return true;
  }
);

export const updateDownloadableFileInputIsValid = rule({ cache: "contextual" })(
  async (parent: any, args: UpdateDownloadableFileArgs, ctx: ValidationContext, info: any) => {
    if (!args.update) {
      return "Missing update input in args.";
    }

    // For update operations, we need to find the existing file and its channel connections
    const DownloadableFileModel = ctx.ogm.model("DownloadableFile");
    
    try {
      // Get the existing file and its associated discussions/channels
      // Note: The exact relationship structure may need to be adjusted based on your schema
      const existingFiles = await DownloadableFileModel.find({
        where: args.where,
        selectionSet: `{
          id
          fileName
        }`
      });

      const existingFile = existingFiles?.[0];
      if (!existingFile) {
        return "File not found";
      }

      // For update operations, we'll assume channel validation will be handled
      // by the calling code or you may need to pass channelConnections as an argument
      // This is because finding the current channel connections requires understanding
      // your specific relationship structure between DownloadableFile and Channels
      const channelConnections: string[] = [];
      
      // If your update mutation includes channel connections, extract them here
      if ((args as any).channelConnections) {
        channelConnections.push(...(args as any).channelConnections);
      }

      // Use the new filename if provided, otherwise use existing filename
      const fileName = args.update.fileName || existingFile.fileName;

      const fileTypeValidation = await validateFileTypePermissions(
        fileName,
        channelConnections,
        ctx
      );

      if (fileTypeValidation !== true) {
        return fileTypeValidation;
      }

      return true;
    } catch (error) {
      console.error("Error validating downloadable file update:", error);
      return "Failed to validate file update";
    }
  }
);
