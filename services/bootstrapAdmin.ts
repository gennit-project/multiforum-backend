import type {
  BootstrapAdminRepository,
  BootstrapAdminResult,
} from "./persistence/bootstrapAdminRepository.js";

export type { BootstrapAdminResult };

export type BootstrapAdminInput = {
  repository: BootstrapAdminRepository;
  serverName: string;
  email: string;
  username: string;
  log?: (message: string) => void;
};

export const provisionBootstrapAdmin = async (
  input: BootstrapAdminInput
): Promise<BootstrapAdminResult> => {
  const result = await input.repository.reconcile({
    serverName: input.serverName,
    email: input.email,
    username: input.username,
  });
  const log = input.log ?? (() => {});

  if (result.status === "created") {
    log(`Created bootstrap user '${input.username}'.`);
    log(`Connected bootstrap user '${input.username}' as a SuperAdmin.`);
  } else if (result.status === "connected") {
    log(`Connected bootstrap user '${input.username}' as a SuperAdmin.`);
  } else if (result.status === "unchanged") {
    log(`Bootstrap user '${input.username}' is already a SuperAdmin.`);
  } else {
    log("Skipped bootstrap admin: the database already contains users.");
  }

  return result;
};
