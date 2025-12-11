// Disconnects expired suspensions from a channel.
// This keeps the Suspension nodes for historical display but removes
// them from the channel's active suspended users/mods lists.
import type {
  Suspension,
  ChannelModel,
} from "../../ogm_types.js";

type DisconnectExpiredSuspensionsInput = {
  ogm: any;
  channelUniqueName: string;
  expiredUserSuspensions: Suspension[];
  expiredModSuspensions: Suspension[];
};

type DisconnectExpiredSuspensionsResult = {
  disconnectedUserSuspensionIds: string[];
  disconnectedModSuspensionIds: string[];
};

export async function disconnectExpiredSuspensions(
  input: DisconnectExpiredSuspensionsInput
): Promise<DisconnectExpiredSuspensionsResult> {
  const { ogm, channelUniqueName, expiredUserSuspensions, expiredModSuspensions } = input;

  const Channel: ChannelModel = ogm.model("Channel");

  const disconnectOperations: any = {};

  if (expiredUserSuspensions.length > 0) {
    disconnectOperations.SuspendedUsers = [
      {
        disconnect: expiredUserSuspensions.map((s) => ({
          where: { node: { id: s.id } },
        })),
      },
    ];
  }

  if (expiredModSuspensions.length > 0) {
    disconnectOperations.SuspendedMods = [
      {
        disconnect: expiredModSuspensions.map((s) => ({
          where: { node: { id: s.id } },
        })),
      },
    ];
  }

  if (disconnectOperations.SuspendedUsers || disconnectOperations.SuspendedMods) {
    try {
      await Channel.update({
        where: { uniqueName: channelUniqueName },
        update: disconnectOperations,
      });
    } catch (error) {
      console.error("Error disconnecting expired suspensions", error);
    }
  }

  return {
    disconnectedUserSuspensionIds: expiredUserSuspensions.map((s) => s.id),
    disconnectedModSuspensionIds: expiredModSuspensions.map((s) => s.id),
  };
}
