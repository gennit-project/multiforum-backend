import { rule } from "graphql-shield";
import {
  CanCreateDiscussionArgs,
  CreateDiscussionItem,
  CanUpdateDiscussionArgs,
} from "../rules";
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
        ?.map((connection: any) => connection?.where?.node?.id)
        .filter((id: unknown): id is string => typeof id === "string") || []
  );
}

export async function validateDiscussionDownloadPreferences(
  item: CreateDiscussionItem,
  ctx: any
) {
  const { discussionCreateInput, channelConnections } = item;
  const downloadableFileIds = getDownloadableFileIds(discussionCreateInput);

  if (!discussionCreateInput.hasDownload && !downloadableFileIds.length) {
    return true;
  }

  const downloadsEnabledResult = await validateDownloadChannelsEnabled(
    channelConnections,
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
      channelConnections,
      ctx
    );

    if (fileTypeValidation !== true) {
      return fileTypeValidation;
    }
  }

  return true;
}

export const createDiscussionInputIsValid = rule({ cache: "contextual" })(
  async (parent: any, args: CanCreateDiscussionArgs, ctx: any, info: any) => {
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
        item,
        ctx
      );
      if (downloadValidation !== true) {
        return downloadValidation;
      }

      isValid = true;
    }
    return isValid;
  }
);

export const updateDiscussionInputIsValid = rule({ cache: "contextual" })(
  async (parent: any, args: CanUpdateDiscussionArgs, ctx: any, info: any) => {
    if (!args.discussionUpdateInput) {
      return "Missing discussionUpdateInput in args.";
    }
    return validateDiscussionInput({
      ...args.discussionUpdateInput,
      editMode: true,
    });
  }
);
