import type { OgmLike } from "../seedData/provisionServerDefaults.js";

type Model = {
  find: (args: Record<string, unknown>) => Promise<any[]>;
  create?: (args: Record<string, unknown>) => Promise<unknown>;
  update?: (args: Record<string, unknown>) => Promise<unknown>;
};

export type BootstrapAdminResult =
  | { status: "created"; username: string }
  | { status: "connected"; username: string }
  | { status: "unchanged"; username: string }
  | { status: "skipped"; reason: "database-not-empty" };

export type BootstrapAdminInput = {
  User: Model;
  Email: Model;
  ServerConfig: Model;
  serverName: string;
  email: string;
  username: string;
  log?: (message: string) => void;
};

// OGM's update returns the UpdateServerConfigsMutationResponse type, so the
// selection must reach through the `serverConfigs` node accessor rather than
// selecting node fields directly.
const SERVER_CONFIG_MINIMAL_SELECTION = "{ serverConfigs { serverName } }";

const linkedEmail = (user: any): string | null =>
  typeof user?.Email?.address === "string" ? user.Email.address : null;

const linkedUsername = (email: any): string | null =>
  typeof email?.User?.username === "string" ? email.User.username : null;

export const provisionBootstrapAdmin = async (
  input: BootstrapAdminInput
): Promise<BootstrapAdminResult> => {
  const { User, Email, ServerConfig, serverName, email, username } = input;
  const log = input.log ?? (() => {});

  const [usersByUsername, emailsByAddress] = await Promise.all([
    User.find({
      where: { username },
      selectionSet: "{ username Email { address } }",
    }),
    Email.find({
      where: { address: email },
      selectionSet: "{ address User { username } }",
    }),
  ]);

  const existingUser = usersByUsername[0];
  const existingEmail = emailsByAddress[0];
  if (existingUser && linkedEmail(existingUser) !== email) {
    throw new Error(
      `Cannot bootstrap '${username}': that username is linked to a different email.`
    );
  }
  if (existingEmail && linkedUsername(existingEmail) !== username) {
    throw new Error(
      `Cannot bootstrap '${username}': '${email}' is linked to a different username.`
    );
  }
  if (Boolean(existingUser) !== Boolean(existingEmail)) {
    throw new Error(
      `Cannot bootstrap '${username}': the existing user/email relationship is incomplete.`
    );
  }

  let created = false;
  if (!existingUser) {
    const existingUsers = await User.find({
      options: { limit: 1 },
      selectionSet: "{ username }",
    });
    if (existingUsers.length > 0) {
      log("Skipped bootstrap admin: the database already contains users.");
      return { status: "skipped", reason: "database-not-empty" };
    }
    if (!User.create) {
      throw new Error("User model does not support bootstrap creation.");
    }

    await User.create({
      input: [
        {
          username,
          Email: { create: { node: { address: email } } },
          ModerationProfile: {
            create: { node: { displayName: `bootstrap-${username}` } },
          },
        },
      ],
    });
    created = true;
    log(`Created bootstrap user '${username}'.`);
  }

  const serverConfigs = await ServerConfig.find({
    where: { serverName },
    selectionSet: "{ serverName SuperAdmins { username } }",
  });
  const serverConfig = serverConfigs[0];
  if (!serverConfig) {
    throw new Error(
      `Cannot bootstrap '${username}': ServerConfig '${serverName}' does not exist.`
    );
  }

  const isAlreadySuperAdmin = (serverConfig.SuperAdmins ?? []).some(
    (admin: { username?: string | null }) => admin?.username === username
  );
  if (isAlreadySuperAdmin) {
    log(`Bootstrap user '${username}' is already a SuperAdmin.`);
    return { status: "unchanged", username };
  }
  if (!ServerConfig.update) {
    throw new Error("ServerConfig model does not support bootstrap updates.");
  }

  await ServerConfig.update({
    where: { serverName },
    update: {
      SuperAdmins: [
        { connect: [{ where: { node: { username } } }] },
      ],
    },
    selectionSet: SERVER_CONFIG_MINIMAL_SELECTION,
  });
  log(`Connected bootstrap user '${username}' as a SuperAdmin.`);

  return { status: created ? "created" : "connected", username };
};

export const provisionBootstrapAdminFromOgm = (
  ogm: OgmLike,
  options: {
    serverName: string;
    email: string;
    username: string;
    log?: (message: string) => void;
  }
): Promise<BootstrapAdminResult> =>
  provisionBootstrapAdmin({
    User: ogm.model("User") as Model,
    Email: ogm.model("Email") as Model,
    ServerConfig: ogm.model("ServerConfig") as Model,
    ...options,
  });
