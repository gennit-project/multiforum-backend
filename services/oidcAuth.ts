import axios from "axios";
import jwt from "jsonwebtoken";
import type {
  GetPublicKeyOrSecret,
  JwtHeader,
  JwtPayload,
  SigningKeyCallback,
} from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import NodeCache from "node-cache";

type Environment = NodeJS.ProcessEnv;

export type OidcIdentity = {
  email: string;
  subject: string;
};

type OidcConfiguration = {
  issuerUrl: string;
  audience: string;
  jwksUrl: string;
  userInfoUrl: string;
};

type OidcUserInfo = {
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
};

export const OIDC_AUTH_ENV_VARS = [
  "OIDC_ISSUER_URL",
  "OIDC_AUDIENCE",
  "OIDC_JWKS_URL",
  "OIDC_USERINFO_URL",
] as const;

const jwksClients = new Map<string, jwksClient.JwksClient>();
const userInfoCache = new NodeCache({ stdTTL: 900, useClones: false });

const hasValue = (env: Environment, name: string): boolean =>
  Boolean(env[name]?.trim());

export const getOidcAuthMissingVariables = (
  env: Environment = process.env
): string[] => OIDC_AUTH_ENV_VARS.filter((name) => !hasValue(env, name));

const validateHttpsUrl = (
  value: string,
  name: string,
  env: Environment
): string => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL.`);
  }

  const testLoopbackHttp =
    env.NODE_ENV === "test" &&
    parsed.protocol === "http:" &&
    (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost");
  if (parsed.protocol !== "https:" && !testLoopbackHttp) {
    throw new Error(`${name} must use HTTPS.`);
  }
  if (parsed.username || parsed.password || parsed.hash || parsed.search) {
    throw new Error(`${name} must not contain credentials, a query, or a fragment.`);
  }

  return value;
};

export const getOidcConfiguration = (
  env: Environment = process.env
): OidcConfiguration => {
  const missing = getOidcAuthMissingVariables(env);
  if (missing.length > 0) {
    throw new Error(`OIDC authentication requires: ${missing.join(", ")}.`);
  }

  return {
    issuerUrl: validateHttpsUrl(
      env.OIDC_ISSUER_URL!.trim(),
      "OIDC_ISSUER_URL",
      env
    ),
    audience: env.OIDC_AUDIENCE!.trim(),
    jwksUrl: validateHttpsUrl(env.OIDC_JWKS_URL!.trim(), "OIDC_JWKS_URL", env),
    userInfoUrl: validateHttpsUrl(
      env.OIDC_USERINFO_URL!.trim(),
      "OIDC_USERINFO_URL",
      env
    ),
  };
};

export const isOidcAuthConfigured = (
  env: Environment = process.env
): boolean => {
  try {
    getOidcConfiguration(env);
    return true;
  } catch {
    return false;
  }
};

const getClient = (jwksUrl: string): jwksClient.JwksClient => {
  const existing = jwksClients.get(jwksUrl);
  if (existing) return existing;

  const created = jwksClient({
    jwksUri: jwksUrl,
    cache: true,
    rateLimit: true,
  });
  jwksClients.set(jwksUrl, created);
  return created;
};

const createKeyResolver = (jwksUrl: string): GetPublicKeyOrSecret =>
  (header: JwtHeader, callback: SigningKeyCallback): void => {
    if (!header.kid) {
      callback(new Error("OIDC token header is missing 'kid'."));
      return;
    }

    getClient(jwksUrl).getSigningKey(header.kid, (error, key) => {
      if (error) {
        callback(error);
        return;
      }
      callback(null, key?.getPublicKey());
    });
  };

const verifyJwt = (
  token: string,
  config: OidcConfiguration
): Promise<JwtPayload> =>
  new Promise((resolve, reject) => {
    jwt.verify(
      token,
      createKeyResolver(config.jwksUrl),
      {
        algorithms: ["RS256"],
        issuer: config.issuerUrl,
        audience: config.audience,
      },
      (error, decoded) => {
        if (error) {
          reject(error);
          return;
        }
        if (!decoded || typeof decoded === "string") {
          reject(new Error("OIDC token payload is invalid."));
          return;
        }
        resolve(decoded);
      }
    );
  });

const fetchVerifiedIdentity = async (
  token: string,
  subject: string,
  userInfoUrl: string
): Promise<OidcIdentity> => {
  const cached = userInfoCache.get<OidcIdentity>(token);
  if (cached) return cached;

  const response = await axios.get<OidcUserInfo>(userInfoUrl, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 5_000,
  });
  const userInfo = response.data;
  if (userInfo.sub !== subject) {
    throw new Error("OIDC UserInfo subject does not match the access token.");
  }
  if (typeof userInfo.email !== "string" || !userInfo.email.trim()) {
    throw new Error("OIDC UserInfo response does not contain an email address.");
  }
  if (userInfo.email_verified !== true) {
    throw new Error("OIDC provider has not verified the email address.");
  }

  const identity = { email: userInfo.email.trim(), subject };
  userInfoCache.set(token, identity);
  return identity;
};

export const verifyOidcToken = async (
  token: string,
  env: Environment = process.env
): Promise<OidcIdentity> => {
  const config = getOidcConfiguration(env);
  const decoded = await verifyJwt(token, config);
  if (typeof decoded.sub !== "string" || !decoded.sub) {
    throw new Error("OIDC access token does not contain a subject.");
  }

  return fetchVerifiedIdentity(token, decoded.sub, config.userInfoUrl);
};
