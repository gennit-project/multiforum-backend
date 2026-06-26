// Idempotent provisioning of a Multiforum server's default roles + config.
//
// Safe to run on every boot/deploy and in integration-test setup: roles are
// upserted by their unique name and the ServerConfig default-role links use
// `overwrite`, so re-running converges to the definitions in defaultRoles.ts.
//
// Also performs the isAdmin-phase-out backfill: existing ServerConfig.Admins are
// connected to ServerConfig.SuperAdmins so they keep their current full power
// (operators then demote individuals to restricted Admins as desired).
// See docs/isadmin-phaseout-design.md.

import type {
  ServerRoleModel,
  ModServerRoleModel,
  ServerConfigModel,
} from "../ogm_types.js";
import {
  DEFAULT_SERVER_ROLES,
  DEFAULT_MOD_SERVER_ROLES,
  SERVER_CONFIG_ROLE_WIRING,
} from "./defaultRoles.js";

type AnyModel = {
  find: (args: any) => Promise<any[]>;
  create: (args: any) => Promise<any>;
  update: (args: any) => Promise<any>;
};

export type ProvisionServerDefaultsInput = {
  ServerRole: ServerRoleModel;
  ModServerRole: ModServerRoleModel;
  ServerConfig: ServerConfigModel;
  serverName: string;
  log?: (message: string) => void;
};

export type ProvisionServerDefaultsResult = {
  serverRolesUpserted: number;
  modServerRolesUpserted: number;
  serverConfigCreated: boolean;
  rolesWired: string[];
  adminsBackfilledToSuperAdmins: string[];
};

// Upsert a role by its unique `name`: update when present, create otherwise.
const upsertByName = async (
  model: AnyModel,
  role: Record<string, unknown> & { name: string }
) => {
  const existing = await model.find({ where: { name: role.name } });
  const { name, ...rest } = role;
  if (existing.length > 0) {
    await model.update({ where: { name }, update: rest });
  } else {
    await model.create({ input: [role] });
  }
};

export const provisionServerDefaults = async (
  input: ProvisionServerDefaultsInput
): Promise<ProvisionServerDefaultsResult> => {
  const { ServerRole, ModServerRole, ServerConfig, serverName } = input;
  const log = input.log ?? (() => {});

  // 1. Upsert the default roles (idempotent by name).
  for (const role of DEFAULT_SERVER_ROLES) {
    await upsertByName(ServerRole as unknown as AnyModel, { ...role });
  }
  for (const role of DEFAULT_MOD_SERVER_ROLES) {
    await upsertByName(ModServerRole as unknown as AnyModel, { ...role });
  }
  log(
    `Upserted ${DEFAULT_SERVER_ROLES.length} server roles and ${DEFAULT_MOD_SERVER_ROLES.length} mod server roles.`
  );

  // 2. Ensure the ServerConfig exists, and read the current tier-role links so
  // wiring can be idempotent (the default-role relationships are to-one, so a
  // blind `connect` on an already-linked config violates cardinality).
  const linkSelection = Object.keys(SERVER_CONFIG_ROLE_WIRING)
    .map((relationship) => `${relationship} { name }`)
    .join("\n      ");
  const existingConfigs = await ServerConfig.find({
    where: { serverName },
    selectionSet: `{
      serverName
      Admins { username }
      SuperAdmins { username }
      ${linkSelection}
    }`,
  });
  let serverConfigCreated = false;
  let adminUsernames: string[] = [];
  let superAdminUsernames: string[] = [];
  let currentConfig: Record<string, { name?: string | null } | null> = {};

  if (existingConfigs.length === 0) {
    await ServerConfig.create({ input: [{ serverName }] });
    serverConfigCreated = true;
    log(`Created ServerConfig '${serverName}'.`);
  } else {
    currentConfig = existingConfigs[0] as unknown as Record<
      string,
      { name?: string | null } | null
    >;
    adminUsernames = (existingConfigs[0].Admins ?? [])
      .map((a: { username?: string | null }) => a?.username)
      .filter((u: unknown): u is string => typeof u === "string");
    superAdminUsernames = (existingConfigs[0].SuperAdmins ?? [])
      .map((a: { username?: string | null }) => a?.username)
      .filter((u: unknown): u is string => typeof u === "string");
  }

  // 3. Wire each to-one default-role link to its role, idempotently: skip when
  // it already points at the right role; otherwise disconnect any wrong target
  // first, then connect the right one.
  const rolesWired: string[] = [];
  const wiringUpdate: Record<string, unknown> = {};
  for (const [relationship, roleName] of Object.entries(
    SERVER_CONFIG_ROLE_WIRING
  )) {
    const currentName = currentConfig[relationship]?.name ?? null;
    if (currentName === roleName) {
      continue; // already correct
    }
    const linkUpdate: Record<string, unknown> = {
      connect: { where: { node: { name: roleName } } },
    };
    if (currentName) {
      // Remove the existing (wrong) target before connecting the new one.
      linkUpdate.disconnect = { where: { node: { name: currentName } } };
    }
    wiringUpdate[relationship] = linkUpdate;
    rolesWired.push(relationship);
  }
  if (Object.keys(wiringUpdate).length > 0) {
    await ServerConfig.update({ where: { serverName }, update: wiringUpdate });
  }
  log(`Wired ${rolesWired.length} default-role links on '${serverName}'.`);

  // 4. Backfill: existing Admins that are not yet SuperAdmins get connected, so
  // they keep their current full power after the move to role-based admin.
  const superAdminSet = new Set(superAdminUsernames);
  const adminsToPromote = adminUsernames.filter((u) => !superAdminSet.has(u));
  if (adminsToPromote.length > 0) {
    await ServerConfig.update({
      where: { serverName },
      update: {
        SuperAdmins: adminsToPromote.map((username) => ({
          connect: [{ where: { node: { username } } }],
        })),
      },
    });
    log(
      `Backfilled ${adminsToPromote.length} admin(s) into SuperAdmins: ${adminsToPromote.join(", ")}.`
    );
  }

  return {
    serverRolesUpserted: DEFAULT_SERVER_ROLES.length,
    modServerRolesUpserted: DEFAULT_MOD_SERVER_ROLES.length,
    serverConfigCreated,
    rolesWired,
    adminsBackfilledToSuperAdmins: adminsToPromote,
  };
};
