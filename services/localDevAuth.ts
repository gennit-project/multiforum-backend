import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { getOidcConfiguration } from "./oidcAuth.js";

const LOCAL_DEV_PROVIDER = "local-dev";
const TOKEN_ISSUER = "multiforum-local-dev";
const TOKEN_AUDIENCE = "multiforum-backend";
const TOKEN_LIFETIME_SECONDS = 12 * 60 * 60;

type Environment = NodeJS.ProcessEnv;

export type AuthenticationProvider = "auth0" | "oidc" | typeof LOCAL_DEV_PROVIDER;

export type LocalDevIdentity = {
  email: string;
  username: string;
};

export const LOCAL_DEV_AUTH_ENV_VARS = [
  "NODE_ENV",
  "MULTIFORUM_BOOTSTRAP_EMAIL",
  "MULTIFORUM_BOOTSTRAP_USERNAME",
  "MULTIFORUM_BOOTSTRAP_PASSWORD",
  "SUPERADMIN_EMAIL",
] as const;

const hasValue = (env: Environment, name: string): boolean =>
  Boolean(env[name]?.trim());

export const getAuthenticationProvider = (
  env: Environment = process.env
): AuthenticationProvider => {
  const provider = env.MULTIFORUM_AUTH_PROVIDER?.trim().toLowerCase() || "auth0";
  if (provider !== "auth0" && provider !== "oidc" && provider !== LOCAL_DEV_PROVIDER) {
    throw new Error(
      `Unsupported MULTIFORUM_AUTH_PROVIDER '${provider}'. Use 'auth0', 'oidc', or 'local-dev'.`
    );
  }
  return provider;
};

export const getLocalDevAuthMissingVariables = (
  env: Environment = process.env
): string[] =>
  LOCAL_DEV_AUTH_ENV_VARS.filter((name) => !hasValue(env, name));

const requireLocalDevConfiguration = (env: Environment) => {
  if (getAuthenticationProvider(env) !== LOCAL_DEV_PROVIDER) {
    throw new Error("Local development authentication is not enabled.");
  }
  if (env.NODE_ENV?.trim().toLowerCase() !== "development") {
    throw new Error(
      "MULTIFORUM_AUTH_PROVIDER=local-dev requires NODE_ENV=development and cannot run in production."
    );
  }

  const missing = getLocalDevAuthMissingVariables(env);
  if (missing.length > 0) {
    throw new Error(
      `Local development authentication requires: ${missing.join(", ")}.`
    );
  }

  const email = env.MULTIFORUM_BOOTSTRAP_EMAIL!.trim();
  const superAdminEmail = env.SUPERADMIN_EMAIL!.trim();
  if (email !== superAdminEmail) {
    throw new Error(
      "SUPERADMIN_EMAIL must match MULTIFORUM_BOOTSTRAP_EMAIL in local-dev authentication mode."
    );
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("MULTIFORUM_BOOTSTRAP_EMAIL must be a valid email address.");
  }

  const username = env.MULTIFORUM_BOOTSTRAP_USERNAME!.trim();
  if (!/^[a-zA-Z0-9_]{1,50}$/.test(username)) {
    throw new Error(
      "MULTIFORUM_BOOTSTRAP_USERNAME must contain 1-50 letters, numbers, or underscores."
    );
  }

  const password = env.MULTIFORUM_BOOTSTRAP_PASSWORD!;
  if (password.length < 12) {
    throw new Error(
      "MULTIFORUM_BOOTSTRAP_PASSWORD must contain at least 12 characters."
    );
  }

  return {
    email,
    username,
    password,
  };
};

export const assertAuthenticationConfiguration = (
  env: Environment = process.env
): void => {
  const provider = getAuthenticationProvider(env);
  if (provider === LOCAL_DEV_PROVIDER) {
    requireLocalDevConfiguration(env);
  }
  if (provider === "oidc") {
    getOidcConfiguration(env);
  }
};

export const getLocalDevBootstrapIdentity = (
  env: Environment = process.env
): LocalDevIdentity => {
  const { email, username } = requireLocalDevConfiguration(env);
  return { email, username };
};

export const isLocalDevAuthConfigured = (
  env: Environment = process.env
): boolean => {
  try {
    requireLocalDevConfiguration(env);
    return true;
  } catch {
    return false;
  }
};

const passwordsMatch = (provided: string, expected: string): boolean => {
  const providedDigest = createHash("sha256").update(provided).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
};

export const issueLocalDevToken = (
  providedPassword: unknown,
  env: Environment = process.env
): string | null => {
  const config = requireLocalDevConfiguration(env);
  if (
    typeof providedPassword !== "string" ||
    !passwordsMatch(providedPassword, config.password)
  ) {
    return null;
  }

  return jwt.sign(
    {
      email: config.email,
      username: config.username,
      email_verified: true,
    },
    config.password,
    {
      algorithm: "HS256",
      audience: TOKEN_AUDIENCE,
      issuer: TOKEN_ISSUER,
      expiresIn: TOKEN_LIFETIME_SECONDS,
      subject: config.username,
    }
  );
};

export const verifyLocalDevToken = (
  token: string,
  env: Environment = process.env
): LocalDevIdentity => {
  const config = requireLocalDevConfiguration(env);
  const decoded = jwt.verify(token, config.password, {
    algorithms: ["HS256"],
    audience: TOKEN_AUDIENCE,
    issuer: TOKEN_ISSUER,
  }) as JwtPayload;

  if (
    decoded.email !== config.email ||
    decoded.username !== config.username ||
    decoded.email_verified !== true ||
    decoded.sub !== config.username
  ) {
    throw new Error(
      "Local development token identity does not match configuration."
    );
  }

  return { email: config.email, username: config.username };
};

export const createLocalDevTokenHandler = (
  env: Environment = process.env
): RequestHandler => {
  return (request, response) => {
    response.setHeader("Cache-Control", "no-store");

    if (getAuthenticationProvider(env) !== LOCAL_DEV_PROVIDER) {
      response.status(404).json({ error: "Not found" });
      return;
    }

    const token = issueLocalDevToken(request.body?.password, env);
    if (!token) {
      response.status(401).json({ error: "Invalid credentials" });
      return;
    }

    response.status(200).json({
      accessToken: token,
      tokenType: "Bearer",
      expiresIn: TOKEN_LIFETIME_SECONDS,
    });
  };
};
