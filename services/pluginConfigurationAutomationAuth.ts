import type { JwtPayload } from "jsonwebtoken";

import type { GraphQLContext } from "../types/context.js";
import {
  getAuth0OidcConfiguration,
  getOidcConfiguration,
  verifyOidcAccessToken,
  type OidcConfiguration,
} from "./oidcAuth.js";

type Environment = NodeJS.ProcessEnv;
type ClaimsVerifier = (
  token: string,
  configuration: OidcConfiguration
) => Promise<JwtPayload>;

export const DEFAULT_PLUGIN_CONFIGURATION_SCOPE =
  "plugin-configuration:write";

export type PluginConfigurationAutomationSettings = {
  allowedSubjects: Set<string>;
  requiredScope: string;
  oidc: OidcConfiguration;
};

const parseSubjects = (value: string): Set<string> => {
  const subjects = value
    .split(",")
    .map(subject => subject.trim())
    .filter(Boolean);
  if (subjects.length === 0 || new Set(subjects).size !== subjects.length) {
    throw new Error(
      "PLUGIN_CONFIGURATION_AUTOMATION_SUBJECTS must contain unique, non-empty subjects."
    );
  }
  return new Set(subjects);
};

export const getPluginConfigurationAutomationSettings = (
  env: Environment = process.env
): PluginConfigurationAutomationSettings | null => {
  const subjectList = env.PLUGIN_CONFIGURATION_AUTOMATION_SUBJECTS?.trim();
  if (!subjectList) return null;

  const provider =
    env.MULTIFORUM_AUTH_PROVIDER?.trim().toLowerCase() || "auth0";
  if (provider === "local-dev") {
    throw new Error(
      "Plugin configuration automation requires auth0 or oidc authentication."
    );
  }
  if (provider !== "auth0" && provider !== "oidc") {
    throw new Error(
      "Plugin configuration automation requires a supported authentication provider."
    );
  }

  const requiredScope =
    env.PLUGIN_CONFIGURATION_AUTOMATION_SCOPE?.trim() ||
    DEFAULT_PLUGIN_CONFIGURATION_SCOPE;
  if (/\s/.test(requiredScope)) {
    throw new Error(
      "PLUGIN_CONFIGURATION_AUTOMATION_SCOPE must contain exactly one scope."
    );
  }

  return {
    allowedSubjects: parseSubjects(subjectList),
    requiredScope,
    oidc:
      provider === "auth0"
        ? getAuth0OidcConfiguration(env)
        : getOidcConfiguration(env),
  };
};

export const assertPluginConfigurationAutomationConfiguration = (
  env: Environment = process.env
): void => {
  getPluginConfigurationAutomationSettings(env);
};

const getBearerToken = (context: GraphQLContext): string | null => {
  const value = context.req?.headers.authorization;
  if (typeof value !== "string") return null;
  const match = /^Bearer ([^\s]+)$/.exec(value);
  return match?.[1] ?? null;
};

const getScopes = (claims: JwtPayload): Set<string> => {
  const scope =
    typeof claims.scope === "string"
      ? claims.scope.split(/\s+/).filter(Boolean)
      : [];
  const permissions = Array.isArray(claims.permissions)
    ? claims.permissions.filter(
        (permission): permission is string => typeof permission === "string"
      )
    : [];
  return new Set([...scope, ...permissions]);
};

export const authenticatePluginConfigurationAutomation = async (
  context: GraphQLContext,
  env: Environment = process.env,
  verifyClaims: ClaimsVerifier = verifyOidcAccessToken
): Promise<boolean> => {
  if (context.pluginConfigurationAutomation) return true;

  let settings: PluginConfigurationAutomationSettings | null;
  try {
    settings = getPluginConfigurationAutomationSettings(env);
  } catch {
    return false;
  }
  if (!settings) return false;

  const token = getBearerToken(context);
  if (!token) return false;

  try {
    const claims = await verifyClaims(token, settings.oidc);
    const subject = typeof claims.sub === "string" ? claims.sub : "";
    if (
      !subject ||
      !settings.allowedSubjects.has(subject) ||
      !getScopes(claims).has(settings.requiredScope)
    ) {
      return false;
    }
    context.pluginConfigurationAutomation = {
      subject,
      scope: settings.requiredScope,
    };
    return true;
  } catch {
    return false;
  }
};
