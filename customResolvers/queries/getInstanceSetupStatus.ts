import type { ServerConfigModel } from "../../ogm_types.js";
import {
  getAuthenticationProvider,
  getLocalDevAuthMissingVariables,
  isLocalDevAuthConfigured,
} from "../../services/localDevAuth.js";
import {
  getOidcAuthMissingVariables,
  isOidcAuthConfigured,
} from "../../services/oidcAuth.js";

type Environment = NodeJS.ProcessEnv;

type ServerFeatureConfig = {
  enableDownloads?: boolean | null;
  enableEvents?: boolean | null;
};

export type InstanceCapabilityStatus = {
  configured: boolean;
  enabled: boolean;
  requiredEnvVarsMissing: string[];
  setupUrl: string;
  docsPath: string;
};

export type InstanceSetupStatus = {
  auth: InstanceCapabilityStatus;
  mail: InstanceCapabilityStatus;
  maps: InstanceCapabilityStatus;
  geocoding: InstanceCapabilityStatus;
  uploads: InstanceCapabilityStatus;
  downloads: InstanceCapabilityStatus;
  events: InstanceCapabilityStatus;
  plugins: InstanceCapabilityStatus;
};

type Input = {
  ServerConfig: ServerConfigModel;
  env?: Environment;
};

const hasValue = (env: Environment, name: string): boolean =>
  Boolean(env[name]?.trim());

const missingVariables = (env: Environment, names: string[]): string[] =>
  names.filter((name) => !hasValue(env, name));

const capability = ({
  configured,
  enabled = configured,
  requiredEnvVarsMissing,
  setupUrl,
  docsPath,
}: InstanceCapabilityStatus): InstanceCapabilityStatus => ({
  configured,
  enabled,
  requiredEnvVarsMissing,
  setupUrl,
  docsPath,
});

const missingMailVariables = (env: Environment): string[] => {
  const provider = env.EMAIL_PROVIDER?.trim().toLowerCase() || "resend";
  if (provider === "sendgrid") {
    return missingVariables(env, ["EMAIL_FROM", "SENDGRID_API_KEY"]);
  }
  if (provider === "resend") {
    return missingVariables(env, ["EMAIL_FROM", "RESEND_API_KEY"]);
  }
  return ["EMAIL_PROVIDER"];
};

export const buildInstanceSetupStatus = ({
  env,
  serverConfig,
}: {
  env: Environment;
  serverConfig: ServerFeatureConfig | null;
}): InstanceSetupStatus => {
  const authProvider = getAuthenticationProvider(env);
  const authMissing = authProvider === "local-dev"
    ? getLocalDevAuthMissingVariables(env)
    : authProvider === "oidc"
      ? getOidcAuthMissingVariables(env)
      : missingVariables(env, [
          "AUTH0_DOMAIN",
          "AUTH0_CLIENT_ID",
          "AUTH0_AUDIENCE",
        ]);
  const mailMissing = missingMailVariables(env);
  const mapsMissing = missingVariables(env, ["VITE_GOOGLE_MAPS_API_KEY"]);
  const geocodingMissing = missingVariables(env, ["VITE_OPEN_CAGE_API_KEY"]);
  const uploadsMissing = missingVariables(env, ["GCS_BUCKET_NAME"]);
  const downloadsMissing = missingVariables(env, [
    "GCS_PRIVATE_DOWNLOAD_BUCKET_NAME",
  ]);
  const pluginsMissing = missingVariables(env, [
    "PLUGIN_SECRET_ENCRYPTION_KEY",
  ]);

  const authConfigured = authProvider === "local-dev"
    ? isLocalDevAuthConfigured(env)
    : authProvider === "oidc"
      ? isOidcAuthConfigured(env)
      : authMissing.length === 0;
  const mailConfigured = mailMissing.length === 0;
  const mapsConfigured = mapsMissing.length === 0;
  const geocodingConfigured = geocodingMissing.length === 0;
  const uploadsConfigured = uploadsMissing.length === 0;
  const downloadsConfigured = downloadsMissing.length === 0;
  const eventsConfigured = serverConfig !== null;
  const pluginsConfigured = serverConfig !== null && pluginsMissing.length === 0;

  return {
    auth: capability({
      configured: authConfigured,
      enabled: authConfigured,
      requiredEnvVarsMissing: authMissing,
      setupUrl: "/admin/setup#authentication",
      docsPath: "/authentication",
    }),
    mail: capability({
      configured: mailConfigured,
      enabled: mailConfigured,
      requiredEnvVarsMissing: mailMissing,
      setupUrl: "/admin/setup#email",
      docsPath: "/roles/admins/email-notifications",
    }),
    maps: capability({
      configured: mapsConfigured,
      enabled: mapsConfigured,
      requiredEnvVarsMissing: mapsMissing,
      setupUrl: "/admin/setup#maps",
      docsPath: "/roles/admins/map-setup",
    }),
    geocoding: capability({
      configured: geocodingConfigured,
      enabled: geocodingConfigured,
      requiredEnvVarsMissing: geocodingMissing,
      setupUrl: "/admin/setup#geocoding",
      docsPath: "/roles/admins/map-setup",
    }),
    uploads: capability({
      configured: uploadsConfigured,
      enabled: uploadsConfigured,
      requiredEnvVarsMissing: uploadsMissing,
      setupUrl: "/admin/setup#file-uploads",
      docsPath: "/roles/admins/image-hosting",
    }),
    downloads: capability({
      configured: downloadsConfigured,
      enabled: downloadsConfigured && serverConfig?.enableDownloads === true,
      requiredEnvVarsMissing: downloadsMissing,
      setupUrl: "/admin/setup#downloads",
      docsPath: "/roles/forum-owners/downloads-setup",
    }),
    events: capability({
      configured: eventsConfigured,
      enabled: eventsConfigured && serverConfig?.enableEvents === true,
      requiredEnvVarsMissing: [],
      setupUrl: "/admin/setup#events",
      docsPath: "/config/server-config",
    }),
    plugins: capability({
      configured: pluginsConfigured,
      enabled: pluginsConfigured,
      requiredEnvVarsMissing: pluginsMissing,
      setupUrl: "/admin/setup#plugins",
      docsPath: "/roles/admins/plugin-pipelines",
    }),
  };
};

const getInstanceSetupStatus = ({ ServerConfig, env = process.env }: Input) => {
  return async () => {
    const serverName = env.SERVER_CONFIG_NAME?.trim();
    const serverConfigs = await ServerConfig.find({
      ...(serverName ? { where: { serverName } } : {}),
      selectionSet: "{ serverName enableDownloads enableEvents }",
    });
    const serverConfig = (serverConfigs[0] as ServerFeatureConfig | undefined) ?? null;

    return buildInstanceSetupStatus({ env, serverConfig });
  };
};

export default getInstanceSetupStatus;
