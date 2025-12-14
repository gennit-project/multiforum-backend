import { Neo4jGraphQL } from "@neo4j/graphql";
import { ApolloServer } from "apollo-server";
import { applyMiddleware } from "graphql-middleware";
import typesDefinitions from "./typeDefs.js";
import permissions from "./permissions.js";
import discussionVersionHistoryMiddleware from "./middleware/discussionVersionHistoryMiddleware.js";
import commentVersionHistoryMiddleware from "./middleware/commentVersionHistoryMiddleware.js";
import wikiPageVersionHistoryMiddleware from "./middleware/wikiPageVersionHistoryMiddleware.js";
import path from "path";
import dotenv from "dotenv";
import pkg from "@neo4j/graphql-ogm";
import getCustomResolvers from "./customResolvers.js";
import { fileURLToPath } from "url";
import axios from "axios";
import fs from "fs";
import { CommentNotificationService } from "./services/commentNotificationService.js";
import { DiscussionVersionHistoryService } from "./services/discussionVersionHistoryService.js";
import { CommentVersionHistoryService } from "./services/commentVersionHistoryService.js";
import { WikiPageVersionHistoryService } from "./services/wikiPageVersionHistoryService.js";
import { logCriticalError, errorHandlingPlugin } from "./errorHandling.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { generate } = pkg;
dotenv.config();
import neo4j from "neo4j-driver";
async function connectToNeo4jWithRetry(driver, maxRetries = 10, retryDelay = 5000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`🔌 Attempting to connect to Neo4j (Attempt ${attempt}/${maxRetries})...`);
            const session = driver.session();
            await session.run("RETURN 1");
            console.log("✅ Connected to Neo4j!");
            session.close();
            return; // Exit loop on successful connection
        }
        catch (error) {
            console.error(`❌ Neo4j connection attempt ${attempt} failed:`, {
                attempt,
                maxRetries,
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            if (attempt === maxRetries) {
                const criticalError = new Error(`Failed to connect to Neo4j after ${maxRetries} attempts: ${error.message}`);
                logCriticalError(criticalError, {
                    service: 'Neo4j',
                    attempts: maxRetries,
                    lastError: error.message
                });
                throw criticalError;
            }
            console.log(`⏳ Retrying in ${retryDelay / 1000} seconds...`);
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
const sendSlackNotification = async (text) => {
    if (!process.env.SLACK_WEBHOOK_URL) {
        console.error("SLACK_WEBHOOK_URL environment variable is not set");
        return;
    }
    try {
        await axios.post(process.env.SLACK_WEBHOOK_URL, {
            text: text,
        });
        console.log("Slack notification sent successfully");
    }
    catch (error) {
        console.error("Error sending Slack notification:", error);
    }
};
const extractMutationName = (query) => {
    const match = query.match(/mutation\s+(\w+)/);
    return match ? match[1] : 'Unknown Mutation';
};
const uri = process.env.NEO4J_URI || "bolt://localhost:7687";
const password = process.env.NEO4J_PASSWORD;
const port = process.env.PORT || 4000;
const user = process.env.NEO4J_USER || "neo4j";
const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
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
async function initializeServer() {
    try {
        console.log("🚀 Initializing server...");
        await connectToNeo4jWithRetry(driver);
        const session = driver.session();
        const result = await session.run("CALL dbms.components()");
        const edition = result.records[0].get("edition");
        console.log(`✅ Connected to Neo4j Edition: ${edition}`);
        session.close();
        if (edition === "enterprise") {
            // These constraints are needed for data integrity, but can be skipped
            // for the purpose of running Cypress tests against a local backend and
            // a local instance of neo4j community edition.
            await driver.session().run(ensureUniqueDiscussionChannelRelationship);
            await driver.session().run(ensureUniqueEventChannelRelationship);
            await driver.session().run(ensureUniqueIssueNumberPerChannel);
        }
        if (process.env.GENERATE_OGM_TYPES === "true") {
            const outFile = path.join(__dirname, "ogm-types.ts");
            await generate({
                ogm,
                outFile,
            });
            console.log(`Generated OGM types at ${outFile}`);
            process.exit(1);
        }
        let schema = await neoSchema.getSchema();
        schema = applyMiddleware(schema, permissions, discussionVersionHistoryMiddleware, commentVersionHistoryMiddleware, wikiPageVersionHistoryMiddleware);
        await ogm.init();
        if (edition === "enterprise") {
            await neoSchema.assertIndexesAndConstraints();
        }
        const server = new ApolloServer({
            persistedQueries: false,
            schema,
            plugins: [errorHandlingPlugin],
            context: async (input) => {
                var _a;
                const { req } = input;
                const queryString = `Query: ${req.body.query}`;
                const isMutation = (_a = req.body.query) === null || _a === void 0 ? void 0 : _a.trim().startsWith("mutation");
                // Add this information to the context so it can be used by permission rules
                req.isMutation = isMutation;
                if (!queryString.includes("IntrospectionQuery")) {
                    console.log('📊 GraphQL Operation:', {
                        type: isMutation ? 'Mutation' : 'Query',
                        operationName: req.body.operationName || 'Anonymous',
                        query: req.body.query,
                        variables: req.body.variables
                    });
                    if (isMutation) {
                        const mutationName = extractMutationName(req.body.query);
                        const text = `Mutation: ${mutationName}\nVariables: ${JSON.stringify(req.body.variables, null, 2)}`;
                        // Send Slack notification
                        await sendSlackNotification(text);
                    }
                }
                return {
                    driver,
                    req,
                    ogm,
                };
            },
        });
        server.listen({
            port,
            cors: {
                origin: "*",
                credentials: true,
            },
        }).then(({ url }) => {
            console.log(`🚀 Server ready at ${url}`);
            console.log(`📊 GraphQL Playground available at ${url}`);
            console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
            // Start services with enhanced error handling
            startBackgroundServices(schema, ogm);
        }).catch(error => {
            logCriticalError(error, {
                service: 'Apollo Server',
                port,
                action: 'server.listen'
            });
            throw error;
        });
    }
    catch (e) {
        console.error("💥 Failed to initialize server:", e);
        logCriticalError(e, {
            service: 'Server Initialization',
            step: 'initializeServer'
        });
        process.exit(1);
    }
}
/**
 * Start background services with enhanced error handling
 */
async function startBackgroundServices(schema, ogm) {
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
            console.log(`🔄 Starting ${name}...`);
            const serviceInstance = service();
            await serviceInstance.start();
            console.log(`✅ ${name} started successfully`);
        }
        catch (error) {
            console.error(`❌ Failed to start ${name}:`, error);
            if (critical) {
                logCriticalError(error, {
                    service: name,
                    action: 'service.start'
                });
                throw error; // Stop server if critical service fails
            }
            else {
                // Log non-critical service failures but continue
                console.warn(`⚠️  ${name} failed to start but server will continue`);
            }
        }
    }
}
initializeServer();
