// Idempotent provisioning of a Multiforum server's default roles + config.
//
// Safe to run on every boot/deploy and in integration-test setup. The
// repository reconciles the complete graph in one transaction, including the
// isAdmin-phase-out backfill from Admins to SuperAdmins.

import {
  DEFAULT_MOD_SERVER_ROLES,
  DEFAULT_SERVER_ROLES,
  SERVER_CONFIG_ROLE_WIRING,
} from "./defaultRoles.js";
import type {
  DefaultRoleRelationship,
  ServerDefaultsRepository,
  ServerDefaultsResult,
} from "../services/persistence/serverDefaultsRepository.js";

export type ProvisionServerDefaultsResult = ServerDefaultsResult;

export type ProvisionServerDefaultsInput = {
  repository: ServerDefaultsRepository;
  serverName: string;
  log?: (message: string) => void;
};

export const provisionServerDefaults = async (
  input: ProvisionServerDefaultsInput
): Promise<ProvisionServerDefaultsResult> => {
  const result = await input.repository.reconcile({
    serverName: input.serverName,
    serverRoles: DEFAULT_SERVER_ROLES,
    modServerRoles: DEFAULT_MOD_SERVER_ROLES,
    wiring: Object.entries(SERVER_CONFIG_ROLE_WIRING).map(
      ([relationship, roleName]) => ({
        relationship: relationship as DefaultRoleRelationship,
        roleName,
      })
    ),
  });
  const log = input.log ?? (() => {});

  log(
    `Upserted ${result.serverRolesUpserted} server roles and ${result.modServerRolesUpserted} mod server roles.`
  );
  if (result.serverConfigCreated) {
    log(`Created ServerConfig '${input.serverName}'.`);
  }
  log(
    `Wired ${result.rolesWired.length} default-role links on '${input.serverName}'.`
  );
  if (result.adminsBackfilledToSuperAdmins.length > 0) {
    log(
      `Backfilled ${result.adminsBackfilledToSuperAdmins.length} admin(s) into SuperAdmins: ${result.adminsBackfilledToSuperAdmins.join(", ")}.`
    );
  }

  return result;
};
