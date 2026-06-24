import { ERROR_MESSAGES } from "../errorMessages.js";
import { EmailModel } from "../../ogm_types.js";
import type { GraphQLContext, GraphQLRequest, Ogm } from "../../types/context.js";
import { rule } from "graphql-shield";
import type { GraphQLResolveInfo } from "graphql";
import jwt from "jsonwebtoken";
import type {
  GetPublicKeyOrSecret,
  JwtHeader,
  SigningKeyCallback,
} from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import axios from "axios";
import NodeCache from "node-cache";
import { logger } from "../../logger.js";

type CachedUserInfo = {
  email: string | null;
};

const isMockAuthEnabled = () =>
  process.env.E2E_MOCK_AUTH === "true" ||
  process.env.PLAYWRIGHT_MOCK_AUTH === "true";

const decodeMockTokenPayload = (token: string) => {
  const decodedMock = jwt.decode(token);

  if (!decodedMock || typeof decodedMock === "string") {
    return { email: null, username: null };
  }

  return {
    email:
      typeof decodedMock.email === "string" ? decodedMock.email : null,
    username:
      typeof decodedMock.username === "string" ? decodedMock.username : null,
  };
};

// Lazy initialization of the JWKS client
let client: jwksClient.JwksClient | null = null;

// Cache response from Auth0 userinfo endpoint
// so that we will not hit the rate limit.
const userInfoCache = new NodeCache({ stdTTL: 900 }); // Cache expires in 15 minutes

const getJwksClient = () => {
  if (!client) {
    if (!process.env.AUTH0_DOMAIN) {
      throw new Error("AUTH0_DOMAIN environment variable is not defined");
    }
    client = jwksClient({
      jwksUri: `https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`,
    });
  }
  return client;
};

const getKey: GetPublicKeyOrSecret = (header: JwtHeader, callback: SigningKeyCallback) => {
  if (!header || !header.kid) {
    return callback(new Error("Missing 'kid' in JWT header"), undefined);
  }

  try {
    const jwksClientInstance = getJwksClient(); // Lazily initialize the JWKS client
    jwksClientInstance.getSigningKey(header.kid, (err: Error | null, key?: jwksClient.SigningKey) => {
      if (err) {
        logger.error("Error retrieving signing key:", err);
        if ((err as NodeJS.ErrnoException).code === "ENOTFOUND") {
          logger.error(
            `DNS resolution failed for domain: ${process.env.AUTH0_DOMAIN}`
          );
        }
        return callback(err, undefined);
      }
      const signingKey = key?.getPublicKey();
      callback(null, signingKey);
    });
  } catch (error) {
    logger.error("Error initializing JWKS client or retrieving key:", error);
    return callback(error instanceof Error ? error : new Error(String(error)), undefined);
  }
};

export const getModProfileNameFromUsername = async (
  username: string,
  ogm: Ogm,
  jwtError?: Error
) => {
  const User = ogm.model("User");
  try {
    const userData = await User.find({
      where: { username },
      selectionSet: `{
        ModerationProfile {
          displayName
        }
      }`,
    });
    return userData[0]?.ModerationProfile?.displayName;
  } catch (error) {
    logger.error("Error fetching mod profile name:", error);
    return null;
  }
}

export const getUserFromEmail = async (
  email: string,
  EmailModel: EmailModel
) => {
  if (email === process.env.CYPRESS_ADMIN_TEST_EMAIL) {
    // Prevent a catch-22 in which the user data can't be created
    // because no one has permission to create the user data.
    return process.env.CYPRESS_ADMIN_TEST_USERNAME;
  }
  try {
    const emailDataWithUser = await EmailModel.find({
      where: { address: email },
      selectionSet: `{ User { username } }`,
    });
    return emailDataWithUser[0]?.User?.username;
  } catch (error) {
    logger.error("Error fetching user from database:", error);
    return null;
  }
};



export type AuthContextForUserLookup = {
  ogm: Ogm;
  req?: GraphQLRequest;
  jwtError?: Error;
};

type SetUserDataInput = {
  context: AuthContextForUserLookup;
  getPermissionInfo: boolean;
  checkSpecificChannel?: string;
};

export type UserDataOnContext = {
  username: string | null;
  email: string | null;
  email_verified: boolean;
  data: any;
};

export const setUserDataOnContext = async (
  input: SetUserDataInput
): Promise<UserDataOnContext> => {
  const { context } = input;
  const { ogm, req } = context;
  const token = req?.headers?.authorization?.replace("Bearer ", "");

  if (!token) {
    return {
      username: null,
      email: null,
      email_verified: false,
      data: null,
    };
  }

  let email: string | null = null;
  let decoded: any;
  let username: string | null | undefined = null;
  let modProfileName: string | null | undefined = null;

  if (token) {
    if (isMockAuthEnabled()) {
      const mockPayload = decodeMockTokenPayload(token);
      email = mockPayload.email;
      username = mockPayload.username;

      if (!username && email) {
        username = await getUserFromEmail(email, ogm.model("Email"));
      }

      if (username) {
        modProfileName = await getModProfileNameFromUsername(username, ogm);
      }
    }

    if (!username && !email) {
      if (!process.env.AUTH0_DOMAIN) {
        throw new Error("AUTH0_DOMAIN environment variable is not defined.");
      }

    decoded = await new Promise((resolve, reject) => {
      jwt.verify(token, getKey, { algorithms: ["RS256"] }, (err, decoded) => {
        if (!err) {
          resolve(decoded);
          return;
        } 
        logger.error("JWT Verification Error:", err);
        
        // Check if this is a mutation to determine how to handle the error
        const isMutation = context.req?.isMutation === true;
        logger.info("🔍 JWT Error Debug:", {
          errorName: err.name,
          isMutation,
          requestBody: context.req?.body?.query?.substring(0, 100)
        });
        
        if (err.name === 'TokenExpiredError') {
          const errorMessage = ERROR_MESSAGES.channel.tokenExpired || "Your session has expired. Please sign in again.";
          if (isMutation) {
            // For mutations, throw the error immediately
            logger.info("🚨 Rejecting JWT promise for mutation with expired token");
            reject(new Error(errorMessage));
            return;
          } else {
            // For queries, store the error on context and let the rules handle it
            logger.info("📝 Setting JWT error on context for query");
            context.jwtError = new Error(errorMessage);
          }
        } else {
          const errorMessage = ERROR_MESSAGES.channel.invalidToken || "Your authentication token is invalid. Please sign in again.";
          if (isMutation) {
            // For mutations, throw the error immediately
            logger.info("🚨 Rejecting JWT promise for mutation with invalid token");
            reject(new Error(errorMessage));
            return;
          } else {
            // For queries, store the error on context and let the rules handle it
            logger.info("📝 Setting JWT error on context for query");
            context.jwtError = new Error(errorMessage);
          }
        }
        // For queries, resolve with null and let the rule handlers decide how to handle it
        resolve(null);
      });
      });

      // Check the audience of the token
      const audience = decoded?.aud;

      // A token is accepted as "programmatic" (server-to-server / server-session)
      // if its audience matches a recognized API. `aud` may be a string or an
      // array, so match either form.
      const audienceMatches = (target: string | undefined) =>
        !!target &&
        (audience === target ||
          (Array.isArray(audience) && audience.includes(target)));
      const isProgrammaticToken =
        // Legacy: tokens minted for the Auth0 Management API.
        audienceMatches("https://gennit.us.auth0.com/api/v2/") ||
        // Dedicated app API (server-session SDK). Set AUTH0_AUDIENCE to the
        // API identifier registered in Auth0, e.g. https://api.c0nduit.app
        audienceMatches(process.env.AUTH0_AUDIENCE);

      if (audience === process.env.AUTH0_CLIENT_ID) {
        // UI-based token
        email = decoded?.email;
      } else if (isProgrammaticToken) {
        // Programmatic token

        // Check if userinfo is cached
        const cachedUserInfo: CachedUserInfo | undefined =
          userInfoCache.get(token);

        if (cachedUserInfo) {
          email = cachedUserInfo.email;
        } else {
          try {
            const userInfoResponse = await axios.get(
              `https://${process.env.AUTH0_DOMAIN}/userinfo`,
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                },
              }
            );
            email = userInfoResponse?.data?.email;
          } catch (error) {
            logger.error("Error fetching email from Auth0 userinfo:", error);
          }

          // Cache the userinfo response
          const userInfoToCache: CachedUserInfo = { email };
          userInfoCache.set(token, userInfoToCache);
        }
      }  else {
        logger.error("Token audience is unrecognized.");
      }

      // Get the username from the email by calling getUserFromEmail
      if (email) {
        username = await getUserFromEmail(email, ogm.model("Email"));
      }
      if (username) {
        modProfileName = await getModProfileNameFromUsername(username, ogm);
      }
    }
  }

  return {
    username: username || null,
    email,
    email_verified: isMockAuthEnabled() ? true : false,
    data: {
      ServerRoles: [],
      ChannelRoles: [],
      ModerationProfile: modProfileName ? { displayName: modProfileName } : null,
    },
  };
};

export const isAuthenticatedAndVerified = rule({ cache: "contextual" })(
  async (parent: unknown, args: unknown, context: GraphQLContext, info: GraphQLResolveInfo) => {
    // Determine whether the current operation is a mutation (fallback to GraphQL info)
    const operationType = info?.operation?.operation;
    const isMutation =
      context.req?.isMutation === true || operationType === "mutation";

    // Ensure downstream helpers rely on a consistent flag even if the context
    // middleware could not infer it (e.g. persisted queries without a query string)
    if (context.req) {
      context.req.isMutation = isMutation;
    }

    try {
      // Set user data on context - this may throw for mutations with JWT errors
      context.user = await setUserDataOnContext({
        context,
        getPermissionInfo: false,
      });
    } catch (error) {
      // JWT errors for mutations are thrown from setUserDataOnContext
      throw error;
    }
    
    // For queries, check if there was a JWT error
    if (context.jwtError && !isMutation) {
      return false;
    }
    
    if (!context.user?.username) {
      // Only throw authentication errors for mutations
      if (isMutation) {
        throw new Error(ERROR_MESSAGES.channel.notAuthenticated);
      } else {
        // For queries, just return false without throwing an error
        return false;
      }
    }

    if (!context.user.email_verified) {
      // Only throw verification errors for mutations
      if (isMutation) {
        throw new Error(ERROR_MESSAGES.channel.notVerified);
      } else {
        // For queries, just return false without throwing an error
        return false;
      }
    }
    
    return true;
  }
);

// Rule that only checks for authentication but not email verification
export const isAuthenticated = rule({ cache: "contextual" })(
  async (parent: unknown, args: unknown, context: GraphQLContext, info: GraphQLResolveInfo) => {
    // Determine the operation type (falling back to GraphQL info when necessary)
    const operationType = info?.operation?.operation;
    const isMutation =
      context.req?.isMutation === true || operationType === "mutation";

    if (context.req) {
      context.req.isMutation = isMutation;
    }

    logger.info("🔐 isAuthenticated rule called for:", context.req?.body?.operationName);
    try {
      // Set user data on context - this may throw for mutations with JWT errors
      context.user = await setUserDataOnContext({
        context,
        getPermissionInfo: false,
      });
      logger.info("✅ setUserDataOnContext completed successfully");
    } catch (error) {
      // JWT errors for mutations are thrown from setUserDataOnContext
      logger.info("🚨 isAuthenticated rule caught error from setUserDataOnContext:", (error as Error).message);
      throw error;
    }
    logger.info("🔍 isAuthenticated debug:", {
      isMutation,
      hasUsername: !!context.user?.username,
      hasJwtError: !!context.jwtError
    });
    
    // For queries, check if there was a JWT error
    if (context.jwtError && !isMutation) {
      logger.info("📝 Returning false for query with JWT error");
      return false;
    }
    
    if (!context.user?.username) {
      // Only throw authentication errors for mutations
      if (isMutation) {
        logger.info("🚨 Throwing not authenticated error for mutation");
        throw new Error(ERROR_MESSAGES.channel.notAuthenticated);
      } else {
        // For queries, just return false without throwing an error
        logger.info("📝 Returning false for query without username");
        return false;
      }
    }
    
    logger.info("✅ isAuthenticated rule passed");
    return true;
  }
);
