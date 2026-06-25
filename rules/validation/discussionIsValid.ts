import { rule } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import type { GraphQLContext } from "../../types/context.js";
import {
  CanCreateDiscussionArgs,
  CreateDiscussionItem,
  CanUpdateDiscussionArgs,
} from "../definitions/contentCreationRules.js";
import {
  MAX_CHARS_IN_DISCUSSION_BODY,
  MAX_CHARS_IN_DISCUSSION_TITLE,
} from "./constants.js";
import {
  validateDownloadChannelsEnabled,
  validateFileTypePermissions,
} from "./downloadableFileIsValid.js";

type DiscussionInput = {
  title?: string;
  body?: string | null;
  editMode: boolean;
};

type ChannelImagePreference = {
  uniqueName?: string | null;
  imageUploadsEnabled?: boolean | null;
};

const validateDiscussionInput = (input: DiscussionInput): true | string => {
  const { title, body, editMode } = input;

  if (!editMode) {
    if (!title) {
      return "A title is required.";
    }
  }

  if (title && title.length > MAX_CHARS_IN_DISCUSSION_TITLE) {
    return `The discussion title cannot exceed ${MAX_CHARS_IN_DISCUSSION_TITLE} characters.`;
  }

  if (body && body.length > MAX_CHARS_IN_DISCUSSION_BODY) {
    return `The discussion body cannot exceed ${MAX_CHARS_IN_DISCUSSION_BODY} characters.`;
  }

  return true;
};

function getDownloadableFileIds(discussionCreateInput: any) {
  const downloadableFiles = discussionCreateInput?.DownloadableFiles;
  const fieldInputs = Array.isArray(downloadableFiles)
    ? downloadableFiles
    : downloadableFiles
    ? [downloadableFiles]
    : [];

  return fieldInputs.flatMap(
    (fieldInput) =>
      fieldInput?.connect
        ?.map((connection: { where?: { node?: { id?: string } } }) => connection?.where?.node?.id)
        .filter((id: unknown): id is string => typeof id === "string") || []
  );
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function imagesFieldCreatesOrConnectsImages(imagesField: any) {
  return asArray(imagesField).some(
    (fieldInput) =>
      asArray(fieldInput?.create).length > 0 ||
      asArray(fieldInput?.connect).length > 0
  );
}

export function albumInputCreatesOrConnectsImages(albumInput: any) {
  const createNodes = asArray(albumInput?.create).flatMap((createInput) =>
    createInput?.node ? [createInput.node] : []
  );
  const updateNodes = asArray(albumInput?.update).flatMap((updateInput) =>
    updateInput?.node ? [updateInput.node] : []
  );

  return [...createNodes, ...updateNodes].some((node) =>
    imagesFieldCreatesOrConnectsImages(node?.Images)
  );
}

async function validateImageUploadsEnabled(
  channelConnections: string[],
  ctx: GraphQLContext
) {
  const Channel = ctx.ogm.model("Channel");

  const uniqueChannelConnections = Array.from(
    new Set(channelConnections.filter(Boolean))
  );

  for (const channelName of uniqueChannelConnections) {
    const channels = (await Channel.find({
      where: { uniqueName: channelName },
      selectionSet: `{
        uniqueName
        imageUploadsEnabled
      }`,
    })) as ChannelImagePreference[];
    const channel = channels[0];

    if (!channel) {
      return `Channel '${channelName}' not found`;
    }

    if (channel.imageUploadsEnabled === false) {
      return `Image uploads are disabled in channel '${channelName}'.`;
    }
  }

  return true;
}

async function getDiscussionChannelNamesByWhere(where: any, ctx: GraphQLContext) {
  if (!where || Object.keys(where).length === 0) {
    return [];
  }

  const Discussion = ctx.ogm.model("Discussion");
  const discussions = await Discussion.find({
    where,
    selectionSet: `{
      DiscussionChannels {
        channelUniqueName
      }
    }`,
  });

  return (
    discussions?.flatMap(
      (discussion: { DiscussionChannels?: Array<{ channelUniqueName?: string | null }> | null }) =>
        discussion?.DiscussionChannels?.map(
          (discussionChannel: { channelUniqueName?: string | null }) =>
            discussionChannel?.channelUniqueName
        ) || []
    ) || []
  ).filter(
    (channelName: unknown): channelName is string =>
      typeof channelName === "string"
  );
}

export async function validateDiscussionImagePreferences(
  {
    discussionInput,
    channelConnections,
    where,
  }: {
    discussionInput: any;
    channelConnections?: string[];
    where?: any;
  },
  ctx: GraphQLContext
) {
  if (!albumInputCreatesOrConnectsImages(discussionInput?.Album)) {
    return true;
  }

  const targetChannelConnections = channelConnections?.length
    ? channelConnections
    : await getDiscussionChannelNamesByWhere(where, ctx);

  if (!targetChannelConnections.length) {
    return "No channel specified for this operation.";
  }

  return validateImageUploadsEnabled(targetChannelConnections, ctx);
}

// Enforces channel-level download rules when a discussion attaches a download.
// Works for both create and update: downloads are governed by sitewide rules at
// upload time, but the channel's rules (downloadsEnabled + allowedFileTypes)
// only apply once the download is submitted to a channel — which is here. For
// updates with no explicit channelConnections, the discussion's existing
// channels are resolved from `where`.
export async function validateDiscussionDownloadPreferences(
  {
    discussionInput,
    channelConnections,
    where,
  }: {
    discussionInput: any;
    channelConnections?: string[];
    where?: any;
  },
  ctx: GraphQLContext
) {
  const downloadableFileIds = getDownloadableFileIds(discussionInput);

  if (!discussionInput?.hasDownload && !downloadableFileIds.length) {
    return true;
  }

  const targetChannelConnections = channelConnections?.length
    ? channelConnections
    : await getDiscussionChannelNamesByWhere(where, ctx);

  if (!targetChannelConnections.length) {
    return "No channel specified for this operation.";
  }

  const downloadsEnabledResult = await validateDownloadChannelsEnabled(
    targetChannelConnections,
    ctx
  );

  if (downloadsEnabledResult !== true) {
    return downloadsEnabledResult;
  }

  if (!downloadableFileIds.length) {
    return true;
  }

  const DownloadableFile = ctx.ogm.model("DownloadableFile");

  for (const downloadableFileId of downloadableFileIds) {
    const downloadableFiles = await DownloadableFile.find({
      where: { id: downloadableFileId },
      selectionSet: `{
        id
        fileName
      }`,
    });
    const downloadableFile = downloadableFiles?.[0];

    if (!downloadableFile) {
      return `Downloadable file '${downloadableFileId}' not found`;
    }

    const fileTypeValidation = await validateFileTypePermissions(
      downloadableFile.fileName || "",
      targetChannelConnections,
      ctx
    );

    if (fileTypeValidation !== true) {
      return fileTypeValidation;
    }
  }

  return true;
}

export const createDiscussionInputIsValid = rule({ cache: "contextual" })(
  async (parent: unknown, args: CanCreateDiscussionArgs, ctx: GraphQLContext, info: GraphQLResolveInfo) => {
    if (!args.input) {
      return "Missing input in args.";
    }
    let isValid = false;
    const items: CreateDiscussionItem[] = args.input;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const discussionValidation = validateDiscussionInput({
        ...item.discussionCreateInput,
        editMode: false,
      });
      if (discussionValidation !== true) {
        return discussionValidation;
      }

      const downloadValidation = await validateDiscussionDownloadPreferences(
        {
          discussionInput: item.discussionCreateInput,
          channelConnections: item.channelConnections,
        },
        ctx
      );
      if (downloadValidation !== true) {
        return downloadValidation;
      }

      const imageValidation = await validateDiscussionImagePreferences(
        {
          discussionInput: item.discussionCreateInput,
          channelConnections: item.channelConnections,
        },
        ctx
      );
      if (imageValidation !== true) {
        return imageValidation;
      }

      isValid = true;
    }
    return isValid;
  }
);

export const updateDiscussionInputIsValid = rule({ cache: "contextual" })(
  async (parent: unknown, args: CanUpdateDiscussionArgs, ctx: GraphQLContext, info: GraphQLResolveInfo) => {
    const discussionUpdateInput =
      args.discussionUpdateInput || (args as any).update;

    if (!discussionUpdateInput) {
      return "Missing discussionUpdateInput in args.";
    }
    const discussionValidation = validateDiscussionInput({
      ...discussionUpdateInput,
      editMode: true,
    });

    if (discussionValidation !== true) {
      return discussionValidation;
    }

    // Attaching or changing a download via update must respect the channel's
    // download rules, same as create. Previously only image preferences were
    // checked here, so downloads could be added through update unchecked.
    const downloadValidation = await validateDiscussionDownloadPreferences(
      {
        discussionInput: discussionUpdateInput,
        channelConnections: args.channelConnections,
        where: (args as any).where,
      },
      ctx
    );
    if (downloadValidation !== true) {
      return downloadValidation;
    }

    return validateDiscussionImagePreferences(
      {
        discussionInput: discussionUpdateInput,
        channelConnections: args.channelConnections,
        where: (args as any).where,
      },
      ctx
    );
  }
);
