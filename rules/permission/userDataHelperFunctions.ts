import { ERROR_MESSAGES } from "../errorMessages.js";
import { EmailModel } from "../../ogm_types.js";
import { rule } from "graphql-shield";
import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import axios from "axios";
import NodeCache from "node-cache";

type CachedUserInfo = {
  email: string | null;
};

// Lazy initialization of the JWKS client
let client: any = null;

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

const getKey = (header: any, callback: any) => {
  if (!header || !header.kid) {
    return callback(new Error("Missing 'kid' in JWT header"), null);
  }

  try {
    const jwksClientInstance = getJwksClient(); // Lazily initialize the JWKS client
    jwksClientInstance.getSigningKey(header.kid, (err: any, key: any) => {
      if (err) {
        console.error("Error retrieving signing key:", err);
        if (err.code === "ENOTFOUND") {
          console.error(
            `DNS resolution failed for domain: ${process.env.AUTH0_DOMAIN}`
          );
        }
        return callback(err, null);
      }
      const signingKey = key.getPublicKey();
      callback(null, signingKey);
    });
  } catch (error) {
    console.error("Error initializing JWKS client or retrieving key:", error);
    return callback(error, null);
  }
};

export const getModProfileNameFromUsername = async (
  username: string,
  ogm: any,
  jwtError?: any
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
    console.error("Error fetching mod profile name:", error);
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
    console.error("Error fetching user from database:", error);
    return null;
  }
};

type GetUserDataFromUsernameInput = {
  username: string;
  email: string | null;
  checkSpecificChannel?: string;
  ogm: any;
  emailVerified?: boolean;
};

export const getUserDataFromUsername = async (
  input: GetUserDataFromUsernameInput
): Promise<UserDataOnContext> => {
  const { username, emailVerified, ogm, checkSpecificChannel } = input;

  if (username === process.env.CYPRESS_ADMIN_TEST_USERNAME) {
    // Mock the response for the Cypress admin user
    // because the user data is not created in the database
    return {
      username,
      email: input.email,
      email_verified: emailVerified || false,
      data: {
        ServerRoles: [
          {
            name: "Admin Role",
            showAdminTag: true,
            canCreateChannel: true,
            canCreateComment: true,
            canCreateDiscussion: true,
            canCreateEvent: true,
            canGiveFeedback: true,
            canUploadFile: true,
            canUpvoteComment: true,
            canUpvoteDiscussion: true,
          },
        ],
        ChannelRoles: [],
        ModerationProfile: null,
      },
    };
  }
  const User = ogm.model("User");
  let userData = null;
  try {
    userData = await User.find({
      where: { username },
      selectionSet: `{ 
          ModerationProfile {
            displayName
            ModServerRoles {
              canGiveFeedback
            }
            ModChannelRoles ${
              checkSpecificChannel
                ? `(where: { channelUniqueName: "${checkSpecificChannel}" })`
                : ""
            } {
              canGiveFeedback
            }
          }
          ServerRoles { 
            name
            showAdminTag
            canCreateChannel
            canCreateComment
            canCreateDiscussion
            canCreateEvent
            canGiveFeedback
            canUploadFile
            canUpvoteComment
            canUpvoteDiscussion
          }
          ChannelRoles ${
            input.checkSpecificChannel
              ? `(where: { channelUniqueName: "${input.checkSpecificChannel}" })`
              : ""
          } {
            name
            canCreateEvent
            canCreateDiscussion
            canCreateComment
          }
        }`,
    });

    return {
      username,
      email: input.email,
      email_verified: emailVerified || false,
      data: userData[0],
    };
  } catch (error: any) {
    console.error("Error fetching user data:", error.message);
    return {
      username: null,
      email: null,
      email_verified: false,
      data: {
        ServerRoles: [],
        ChannelRoles: [],
        ModerationProfile: null,
      },
    };
  }
};

type SetUserDataInput = {
  context: {
    ogm: any;
    req: any;
    jwtError?: any;
  };
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

  if (!process.env.AUTH0_DOMAIN) {
    throw new Error("AUTH0_DOMAIN environment variable is not defined.");
  }

  let email: string | null = null;
  let decoded: any;
  let username: string | null | undefined = null;
  let modProfileName: string | null | undefined = null;

  if (token) {
    decoded = await new Promise((resolve, reject) => {
      jwt.verify(token, getKey, { algorithms: ["RS256"] }, (err, decoded) => {
        if (!err) {
          resolve(decoded);
          return;
        } 
        console.error("JWT Verification Error:", err);
        
        // Check if this is a mutation to determine how to handle the error
        const isMutation = context.req?.isMutation === true;
        console.log("🔍 JWT Error Debug:", {
          errorName: err.name,
          isMutation,
          requestBody: context.req?.body?.query?.substring(0, 100)
        });
        
        if (err.name === 'TokenExpiredError') {
          const errorMessage = ERROR_MESSAGES.channel.tokenExpired || "Your session has expired. Please sign in again.";
          if (isMutation) {
            // For mutations, throw the error immediately
            console.log("🚨 Rejecting JWT promise for mutation with expired token");
            reject(new Error(errorMessage));
            return;
          } else {
            // For queries, store the error on context and let the rules handle it
            console.log("📝 Setting JWT error on context for query");
            context.jwtError = new Error(errorMessage);
          }
        } else {
          const errorMessage = ERROR_MESSAGES.channel.invalidToken || "Your authentication token is invalid. Please sign in again.";
          if (isMutation) {
            // For mutations, throw the error immediately
            console.log("🚨 Rejecting JWT promise for mutation with invalid token");
            reject(new Error(errorMessage));
            return;
          } else {
            // For queries, store the error on context and let the rules handle it
            console.log("📝 Setting JWT error on context for query");
            context.jwtError = new Error(errorMessage);
          }
        }
        // For queries, resolve with null and let the rule handlers decide how to handle it
        resolve(null);
      });
    });

    // Check the audience of the token
    const audience = decoded?.aud;

    if (audience === process.env.AUTH0_CLIENT_ID) {
      // UI-based token
      email = decoded?.email;
    } else if (
      Array.isArray(audience) &&
      audience.includes("https://gennit.us.auth0.com/api/v2/")
    ) {
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
          console.error("Error fetching email from Auth0 userinfo:", error);
        }

        // Cache the userinfo response
        const userInfoToCache: CachedUserInfo = { email };
        userInfoCache.set(token, userInfoToCache);
      }
    }  else {
      console.error("Token audience is unrecognized.");
    }

    // Get the username from the email by calling getUserFromEmail
    if (email) {
      username = await getUserFromEmail(email, ogm.model("Email"));
    }
    if (username) {
      modProfileName = await getModProfileNameFromUsername(username, ogm);
    }
  }

  return {
    username: username || null,
    email,
    email_verified: false,
    data: {
      ServerRoles: [],
      ChannelRoles: [],
      ModerationProfile: modProfileName ? { displayName: modProfileName } : null,
    },
  };
};

export const isAuthenticatedAndVerified = rule({ cache: "contextual" })(
  async (parent: any, args: any, context: any, info: any) => {
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
  async (parent: any, args: any, context: any, info: any) => {
    // Determine the operation type (falling back to GraphQL info when necessary)
    const operationType = info?.operation?.operation;
    const isMutation =
      context.req?.isMutation === true || operationType === "mutation";

    if (context.req) {
      context.req.isMutation = isMutation;
    }

    console.log("🔐 isAuthenticated rule called for:", context.req?.body?.operationName);
    try {
      // Set user data on context - this may throw for mutations with JWT errors
      context.user = await setUserDataOnContext({
        context,
        getPermissionInfo: false,
      });
      console.log("✅ setUserDataOnContext completed successfully");
    } catch (error) {
      // JWT errors for mutations are thrown from setUserDataOnContext
      console.log("🚨 isAuthenticated rule caught error from setUserDataOnContext:", (error as Error).message);
      throw error;
    }
    console.log("🔍 isAuthenticated debug:", {
      isMutation,
      hasUsername: !!context.user?.username,
      hasJwtError: !!context.jwtError
    });
    
    // For queries, check if there was a JWT error
    if (context.jwtError && !isMutation) {
      console.log("📝 Returning false for query with JWT error");
      return false;
    }
    
    if (!context.user?.username) {
      // Only throw authentication errors for mutations
      if (isMutation) {
        console.log("🚨 Throwing not authenticated error for mutation");
        throw new Error(ERROR_MESSAGES.channel.notAuthenticated);
      } else {
        // For queries, just return false without throwing an error
        console.log("📝 Returning false for query without username");
        return false;
      }
    }
    
    console.log("✅ isAuthenticated rule passed");
    return true;
  }
);
