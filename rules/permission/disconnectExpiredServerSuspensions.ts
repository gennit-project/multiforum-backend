import type { Suspension } from "../../ogm_types.js";

type DisconnectExpiredServerSuspensionsInput = {
  context: any;
  expiredUserSuspensions: Suspension[];
  expiredModSuspensions: Suspension[];
};

export async function disconnectExpiredServerSuspensions(
  input: DisconnectExpiredServerSuspensionsInput
) {
  const { context, expiredUserSuspensions, expiredModSuspensions } = input;
  const ServerConfig = context.ogm.model("ServerConfig");

  const update: any = {};

  if (expiredUserSuspensions.length > 0) {
    update.SuspendedUsers = [
      {
        disconnect: expiredUserSuspensions.map((suspension) => ({
          where: { node: { id: suspension.id } },
        })),
      },
    ];
  }

  if (expiredModSuspensions.length > 0) {
    update.SuspendedMods = [
      {
        disconnect: expiredModSuspensions.map((suspension) => ({
          where: { node: { id: suspension.id } },
        })),
      },
    ];
  }

  if (!update.SuspendedUsers && !update.SuspendedMods) {
    return {
      disconnectedUserSuspensionIds: [],
      disconnectedModSuspensionIds: [],
    };
  }

  await ServerConfig.update({
    where: { serverName: process.env.SERVER_CONFIG_NAME },
    update,
  });

  return {
    disconnectedUserSuspensionIds: expiredUserSuspensions.map((suspension) => suspension.id),
    disconnectedModSuspensionIds: expiredModSuspensions.map((suspension) => suspension.id),
  };
}
