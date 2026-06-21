import { rule } from "graphql-shield";
import { CanCreateEventArgs, SingleEventInput } from "../rules";
import {
  MAX_CHARS_IN_EVENT_DESCRIPTION,
  MAX_CHARS_IN_EVENT_TITLE,
} from "./constants.js";

type EventInput = {
  title?: string | null;
  description?: string | null;
  virtualEventUrl?: string | null;
};

export const validateEventChannelsEnabled = async (
  channelConnections: string[],
  ctx: any
): Promise<true | string> => {
  const Channel = ctx.ogm.model("Channel");

  for (const channelName of channelConnections) {
    const channels = await Channel.find({
      where: { uniqueName: channelName },
      selectionSet: `{
        uniqueName
        eventsEnabled
      }`,
    });

    const channel = channels?.[0];
    if (!channel) {
      return `Channel '${channelName}' not found.`;
    }

    if (channel.eventsEnabled === false) {
      return `Events are disabled in channel '${channelName}'.`;
    }
  }

  return true;
};

function checkUrl(str: string) {
  // Valid URL checker from Devshed
  // Sources:
  // https://stackoverflow.com/questions/5717093/check-if-a-javascript-string-is-a-url
  // http://forums.devshed.com/javascript-development-115/regexp-to-match-url-pattern-493764.html
  const pattern = new RegExp(
    "^(https?:\\/\\/)" + // protocol
      "((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|" + // domain name
      "((\\d{1,3}\\.){3}\\d{1,3}))" + // OR ip (v4) address
      "(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*" + // port and path
      "(\\?[;&a-z\\d%_.~+=-]*)?" + // query string
      "(\\#[-a-z\\d_]*)?$",
    "i"
  ); // fragment locator
  const valid = !!pattern.test(str);
  return valid;
}

export const validateEventInput = (
  input: EventInput,
  createMode: boolean
): true | string => {
  const { title, description, virtualEventUrl } = input;

  if (!title && createMode) {
    return "A title is required.";
  }

  if (title && title.length > MAX_CHARS_IN_EVENT_TITLE) {
    return `The event title cannot exceed ${MAX_CHARS_IN_EVENT_TITLE} characters.`;
  }

  if (description && description.length > MAX_CHARS_IN_EVENT_DESCRIPTION) {
    return `The event description cannot exceed ${MAX_CHARS_IN_EVENT_DESCRIPTION} characters.`;
  }

  if (virtualEventUrl && !checkUrl(virtualEventUrl)) {
    return "The virtual event URL is not a valid URL.";
  }

  return true;
};

export const createEventInputIsValid = rule({ cache: "contextual" })(
  async (parent: any, args: CanCreateEventArgs, ctx: any, info: any) => {
    if (!args.input) {
      return "Missing input in args.";
    }
    const eventsToCreate = args.input as SingleEventInput[];
    for (const event of eventsToCreate) {
      const validation = validateEventInput(
        {
          title: event.eventCreateInput.title || null,
          description: event.eventCreateInput.description || null,
          virtualEventUrl: event.eventCreateInput.virtualEventUrl || null,
        },
        true
      );
      if (validation !== true) {
        throw new Error(validation);
      }

      const channelValidation = await validateEventChannelsEnabled(
        event.channelConnections || [],
        ctx
      );
      if (channelValidation !== true) {
        throw new Error(channelValidation);
      }
    }
    return true;
  }
);

type CanUpdateEventArgs = {
  eventUpdateInput: EventInput;
};

export const updateEventInputIsValid = rule({ cache: "contextual" })(
  async (parent: any, args: CanUpdateEventArgs, ctx: any, info: any) => {
    if (!args.eventUpdateInput) {
      throw new Error("Missing eventUpdateInput in args.");
    }
    
    const validationResult = validateEventInput(
      {
        title: args.eventUpdateInput?.title || null,
        description: args.eventUpdateInput?.description || null,
        virtualEventUrl: args.eventUpdateInput?.virtualEventUrl || null,
      },
      false
    );

    if (validationResult !== true) {
      throw new Error(validationResult);
    }

    return true;
  }
);
