import { Neo4jGraphQL } from "@neo4j/graphql";
import { ApolloServer } from "@apollo/server";
import { expressMiddleware } from "@as-integrations/express5";
import { ApolloServerPluginDrainHttpServer } from "@apollo/server/plugin/drainHttpServer";
import depthLimit from "graphql-depth-limit";
import express from "express";
import http from "http";
import cors from "cors";
import compression from "compression";
import { applyMiddleware } from "graphql-middleware";
import type { IMiddleware } from "graphql-middleware";
import type { ApolloServerPlugin } from "@apollo/server";
import typesDefinitions from "./typeDefs.js";
import permissions from "./permissions.js";
import discussionVersionHistoryMiddleware from "./middleware/discussionVersionHistoryMiddleware.js";
import commentVersionHistoryMiddleware from "./middleware/commentVersionHistoryMiddleware.js";
import commentMentionsMiddleware from "./middleware/commentMentionsMiddleware.js";
import commentPluginPipelineMiddleware from "./middleware/commentPluginPipelineMiddleware.js";
import commentUserMentionsMiddleware from "./middleware/commentUserMentionsMiddleware.js";
import discussionMentionsMiddleware from "./middleware/discussionMentionsMiddleware.js";
import wikiPageVersionHistoryMiddleware from "./middleware/wikiPageVersionHistoryMiddleware.js";
import issueActivityFeedMiddleware from "./middleware/issueActivityFeedMiddleware.js";
import issueSubscriptionNotificationMiddleware from "./middleware/issueSubscriptionNotificationMiddleware.js";
import channelBotsMiddleware from "./middleware/channelBotsMiddleware.js";
import channelCreatorModeratorMiddleware from "./middleware/channelCreatorModeratorMiddleware.js";
import filterGroupValidationMiddleware from "./middleware/filterGroupValidationMiddleware.js";
import path from "path";
import dotenv from "dotenv";
import getCustomResolvers from "./customResolvers.js";
import { fileURLToPath } from "url";
import fs from "fs";
import { CommentNotificationService } from "./services/commentNotificationService.js";
import { DiscussionVersionHistoryService } from "./services/discussionVersionHistoryService.js";
import { CommentVersionHistoryService } from "./services/commentVersionHistoryService.js";
import { WikiPageVersionHistoryService } from "./services/wikiPageVersionHistoryService.js";
import { logCriticalError, errorHandlingPlugin } from "./errorHandling.js";
import type { GraphQLSchema } from "graphql";
import type { Ogm, GraphQLRequest, GraphQLContext } from "./types/context.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config();

import neo4j, { Driver } from "neo4j-driver";
import { randomUUID } from "node:crypto";
import { logger, runWithContext, enrichContext } from "./logger.js";

async function connectToNeo4jWithRetry(driver: Driver, maxRetries = 10, retryDelay = 5000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`🔌 Attempting to connect to Neo4j (Attempt ${attempt}/${maxRetries})...`);
      const session = driver.session();
      await session.run("RETURN 1");
      logger.info("✅ Connected to Neo4j!");
      session.close();
      return; // Exit loop on successful connection
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      logger.error(`❌ Neo4j connection attempt ${attempt} failed:`, {
        attempt,
        maxRetries,
        error: errorMessage,
        stack: errorStack,
        timestamp: new Date().toISOString()
      });

      if (attempt === maxRetries) {
        const criticalError = new Error(`Failed to connect to Neo4j after ${maxRetries} attempts: ${errorMessage}`);
        logCriticalError(criticalError, {
          service: 'Neo4j',
          attempts: maxRetries,
          lastError: errorMessage
        });
        throw criticalError;
      }
      logger.info(`⏳ Retrying in ${retryDelay / 1000} seconds...`);
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }
}

if (process.env.GOOGLE_CREDENTIALS_BASE64) {
  const credentials = Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, 'base64').toString('utf8');
  const credentialsPath = path.join(__dirname, 'listical-dev-gcp.json');
  fs.writeFileSync(credentialsPath, credentials);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;
}

const uri = process.env.NEO4J_URI || "bolt://localhost:7687";
const password = process.env.NEO4J_PASSWORD;
const port = process.env.PORT || 4000;
const user = process.env.NEO4J_USER || "neo4j";

const driver = neo4j.driver(uri, neo4j.auth.basic(user, password as string));

const { ogm, resolvers } = getCustomResolvers(driver);

const features = {
  filters: {
    String: {
      MATCHES: true,
    },
  },
  // Enable subscriptions for change data capture
  subscriptions: true
};

// Create Neo4j GraphQL schema
const neoSchema = new Neo4jGraphQL({
  typeDefs: typesDefinitions,
  driver,
  resolvers,
  features,
});

const ensureUniqueDiscussionChannelRelationship = `
CREATE CONSTRAINT discussion_channel_unique IF NOT EXISTS FOR (dc:DiscussionChannel)
REQUIRE (dc.discussionId, dc.channelUniqueName) IS NODE KEY
`;

const ensureUniqueEventChannelRelationship = `
CREATE CONSTRAINT event_channel_unique IF NOT EXISTS FOR (ec:EventChannel)
REQUIRE (ec.eventId, ec.channelUniqueName) IS NODE KEY
`;

const ensureUniqueIssueNumberPerChannel = `
CREATE CONSTRAINT issue_channel_issueNumber_unique IF NOT EXISTS FOR (i:Issue)
REQUIRE (i.channelUniqueName, i.issueNumber) IS NODE KEY
`;

const ensureUniqueIssueDiscussionPerChannel = `
CREATE CONSTRAINT issue_channel_discussion_unique IF NOT EXISTS FOR (i:Issue)
REQUIRE (i.channelUniqueName, i.relatedDiscussionId) IS UNIQUE
`;

const ensureUniqueIssueEventPerChannel = `
CREATE CONSTRAINT issue_channel_event_unique IF NOT EXISTS FOR (i:Issue)
REQUIRE (i.channelUniqueName, i.relatedEventId) IS UNIQUE
`;

const ensureUniqueIssueCommentPerChannel = `
CREATE CONSTRAINT issue_channel_comment_unique IF NOT EXISTS FOR (i:Issue)
REQUIRE (i.channelUniqueName, i.relatedCommentId) IS UNIQUE
`;

const ensureUniqueIssueWikiRevisionPerChannel = `
CREATE CONSTRAINT issue_channel_wiki_revision_unique IF NOT EXISTS FOR (i:Issue)
REQUIRE (i.channelUniqueName, i.relatedWikiPageId, i.relatedWikiRevisionId) IS UNIQUE
`;

async function initializeServer() {
  try {
    logger.info("🚀 Initializing server...");

    await connectToNeo4jWithRetry(driver);

    const session = driver.session();
    const result = await session.run("CALL dbms.components()");
    const edition = result.records[0].get("edition");
    logger.info(`✅ Connected to Neo4j Edition: ${edition}`);
    session.close();

    if (edition === "enterprise") {
      // These constraints are needed for data integrity, but can be skipped
      // for the purpose of running Cypress tests against a local backend and
      // a local instance of neo4j community edition.
      await driver.session().run(ensureUniqueDiscussionChannelRelationship);
      await driver.session().run(ensureUniqueEventChannelRelationship);
      await driver.session().run(ensureUniqueIssueNumberPerChannel);
      await driver.session().run(ensureUniqueIssueDiscussionPerChannel);
      await driver.session().run(ensureUniqueIssueEventPerChannel);
      await driver.session().run(ensureUniqueIssueCommentPerChannel);
      await driver.session().run(ensureUniqueIssueWikiRevisionPerChannel);
    }

    let schema = await neoSchema.getSchema();
    type AppMiddleware = IMiddleware<unknown, GraphQLContext>;
    schema = applyMiddleware(
      schema,
      permissions as AppMiddleware,
      discussionVersionHistoryMiddleware as AppMiddleware,
      discussionMentionsMiddleware as AppMiddleware,
      commentVersionHistoryMiddleware as AppMiddleware,
      commentMentionsMiddleware as AppMiddleware,
      commentUserMentionsMiddleware as AppMiddleware,
      commentPluginPipelineMiddleware as AppMiddleware,
      wikiPageVersionHistoryMiddleware as AppMiddleware,
      issueActivityFeedMiddleware as AppMiddleware,
      issueSubscriptionNotificationMiddleware as AppMiddleware,
      channelBotsMiddleware as AppMiddleware,
      channelCreatorModeratorMiddleware as AppMiddleware,
      filterGroupValidationMiddleware as AppMiddleware
    );
    await ogm.init();
    if (edition === "enterprise") {
      await neoSchema.assertIndexesAndConstraints();
    }

    const app = express();
    const httpServer = http.createServer(app);

    // Reject pathologically deep queries before they reach the schema. Neo4jGraphQL
    // translates a nested GraphQL selection into one Cypher query, so an
    // arbitrarily deep query can generate an enormous, slow Cypher pattern — a
    // cheap DoS lever. The bound is generous (real forum queries nest well under
    // this) and tunable via GRAPHQL_MAX_DEPTH; validate against real traffic
    // before tightening it.
    const maxQueryDepth = Number(process.env.GRAPHQL_MAX_DEPTH) || 15;

    const server = new ApolloServer({
      persistedQueries: false,
      schema,
      validationRules: [depthLimit(maxQueryDepth)],
      plugins: [
        // Drains in-flight requests before the HTTP server shuts down.
        ApolloServerPluginDrainHttpServer({ httpServer }),
        errorHandlingPlugin as ApolloServerPlugin,
      ],
    });

    await server.start();

    // Bind a correlation id to every request so all log lines emitted while
    // handling it can be traced back to the same operation.
    app.use((req, _res, next) => {
      runWithContext({ requestId: randomUUID() }, () => next());
    });

    app.use(
      "/",
      cors<cors.CorsRequest>({
        origin: "*",
        credentials: true,
      }),
      // Gzip GraphQL responses — list payloads especially benefit.
      compression(),
      express.json({ limit: "50mb" }),
      expressMiddleware(server, {
        context: async ({ req }) => {
          const queryString = `Query: ${req.body.query}`;
          const isMutation = req.body.query?.trim().startsWith("mutation");

          // Add this information to the context so it can be used by permission rules
          (req as GraphQLRequest).isMutation = isMutation;

          enrichContext({ operationName: req.body.operationName || undefined });

          if (!queryString.includes("IntrospectionQuery")) {
            logger.info('📊 GraphQL Operation:', {
              type: isMutation ? 'Mutation' : 'Query',
              operationName: req.body.operationName || 'Anonymous',
              query: req.body.query,
              variables: req.body.variables
            });
          }

          return {
            driver,
            req,
            ogm,
          };
        },
      })
    );

    await new Promise<void>((resolve) =>
      httpServer.listen({ port }, resolve)
    );

    const url = `http://localhost:${port}/`;
    logger.info(`🚀 Server ready at ${url}`);
    logger.info(`📊 GraphQL endpoint available at ${url}`);
    logger.info(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);

    // Start services with enhanced error handling
    startBackgroundServices(schema, ogm);
  } catch (e) {
    logger.error("💥 Failed to initialize server:", e);
    logCriticalError(e as Error, {
      service: 'Server Initialization',
      step: 'initializeServer'
    });
    process.exit(1);
  }
}

/**
 * Start background services with enhanced error handling
 */
async function startBackgroundServices(schema: GraphQLSchema, ogm: Ogm) {
  const services = [
    {
      name: 'Comment Notification Service',
      service: () => new CommentNotificationService(schema, ogm, driver),
      critical: false
    },
    {
      name: 'Discussion Version History Service', 
      service: () => new DiscussionVersionHistoryService(schema, ogm),
      critical: false
    },
    {
      name: 'Comment Version History Service',
      service: () => new CommentVersionHistoryService(schema, ogm),
      critical: false
    },
    {
      name: 'WikiPage Version History Service',
      service: () => new WikiPageVersionHistoryService(schema, ogm),
      critical: false
    }
  ];

  for (const { name, service, critical } of services) {
    try {
      logger.info(`🔄 Starting ${name}...`);
      const serviceInstance = service();
      await serviceInstance.start();
      logger.info(`✅ ${name} started successfully`);
    } catch (error) {
      logger.error(`❌ Failed to start ${name}:`, error);
      
      if (critical) {
        logCriticalError(error as Error, {
          service: name,
          action: 'service.start'
        });
        throw error; // Stop server if critical service fails
      } else {
        // Log non-critical service failures but continue
        logger.warn(`⚠️  ${name} failed to start but server will continue`);
      }
    }
  }
}

initializeServer();
