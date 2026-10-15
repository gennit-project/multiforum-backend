import type { Driver } from "neo4j-driver";
import {
  provisionServerDefaultsFromOgm,
  type OgmLike,
  type ProvisionServerDefaultsResult,
} from "../seedData/provisionServerDefaults.js";
import {
  provisionBootstrapAdmin,
  type BootstrapAdminInput,
  type BootstrapAdminResult,
} from "./bootstrapAdmin.js";
import {
  createBootstrapAdminRepository,
  type BootstrapAdminRepository,
} from "./persistence/bootstrapAdminRepository.js";
import {
  getAuthenticationProvider,
  getLocalDevBootstrapIdentity,
} from "./localDevAuth.js";

type ProvisionDefaults = (
  ogm: OgmLike,
  options: { serverName: string; log?: (message: string) => void }
) => Promise<ProvisionServerDefaultsResult>;

type ProvisionBootstrapAdmin = (
  input: BootstrapAdminInput
) => Promise<BootstrapAdminResult>;

type StartupBootstrapAdminResult =
  | BootstrapAdminResult
  | { status: "skipped"; reason: "auth-provider" };

export type StartupProvisioningResult =
  | {
      status: "skipped";
      reason: "disabled";
    }
  | {
      status: "provisioned";
      result: ProvisionServerDefaultsResult;
      bootstrapAdmin: StartupBootstrapAdminResult;
    };

export type StartupProvisioningInput = {
  driver: Driver;
  ogm: OgmLike;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
  provision?: ProvisionDefaults;
  provisionBootstrapAdmin?: ProvisionBootstrapAdmin;
  bootstrapAdminRepository?: BootstrapAdminRepository;
};

const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);

export const provisionInstanceOnStartup = async (
  input: StartupProvisioningInput
): Promise<StartupProvisioningResult> => {
  const env = input.env ?? process.env;
  const log = input.log ?? (() => {});
  const autoProvisionValue = env.MULTIFORUM_AUTO_PROVISION?.trim().toLowerCase();

  if (!autoProvisionValue || !ENABLED_VALUES.has(autoProvisionValue)) {
    log("[startup-provision] Skipped: automatic provisioning is not enabled.");
    return { status: "skipped", reason: "disabled" };
  }

  const serverName = env.SERVER_CONFIG_NAME?.trim();
  if (!serverName) {
    throw new Error(
      "SERVER_CONFIG_NAME is required when MULTIFORUM_AUTO_PROVISION is enabled"
    );
  }

  const provision = input.provision ?? provisionServerDefaultsFromOgm;
  const result = await provision(input.ogm, {
    serverName,
    log: (message) => log(`[startup-provision] ${message}`),
  });
  log(
    `[startup-provision] Ready: '${serverName}' has ${result.serverRolesUpserted} server roles and ${result.modServerRolesUpserted} moderator roles.`
  );

  let bootstrapAdmin: StartupBootstrapAdminResult = {
    status: "skipped",
    reason: "auth-provider",
  };
  if (getAuthenticationProvider(env) === "local-dev") {
    const identity = getLocalDevBootstrapIdentity(env);
    const provisionAdmin =
      input.provisionBootstrapAdmin ?? provisionBootstrapAdmin;
    const repository =
      input.bootstrapAdminRepository ??
      createBootstrapAdminRepository(input.driver);
    bootstrapAdmin = await provisionAdmin({
      repository,
      serverName,
      ...identity,
      log: (message) => log(`[startup-provision] ${message}`),
    });
  }

  return { status: "provisioned", result, bootstrapAdmin };
};
