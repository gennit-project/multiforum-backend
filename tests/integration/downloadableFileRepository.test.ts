import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { Neo4jGraphQL } from "@neo4j/graphql";
import type { Driver } from "neo4j-driver";
import getCustomResolvers from "../../customResolvers.js";
import typeDefs from "../../typeDefs.js";
import { initializeOgmFromExistingSchema } from "../../services/initializeOgmFromExistingSchema.js";
import { createOgmPersistence } from "../../services/persistence/ogm.js";
import { createDownloadableFileUrlResolver } from "../../customResolvers/fields/downloadableFileUrl.js";
import type { GraphQLContext } from "../../types/context.js";
import { validateDiscussionDownloadPreferences } from "../../rules/validation/discussionIsValid.js";
import { createDownloadableFileRepository } from "../../services/persistence/downloadableFileRepository.js";
import {
  installRequestScopedBookmarks, runWithRequestBookmarks, getRequestBookmarkManager,
} from "../../services/requestScopedBookmarks.js";
import { resetDatabase, startNeo4j, stopNeo4j } from "./neo4jHarness.js";

let driver: Driver;
let ogm: ReturnType<typeof getCustomResolvers>["ogm"];
let standaloneOgm: ReturnType<typeof createOgmPersistence>["ogm"];

before(async () => {
  driver = installRequestScopedBookmarks(await startNeo4j());
  const app = getCustomResolvers(driver);
  ogm = app.ogm;
  const neoSchema = new Neo4jGraphQL({
    typeDefs,
    driver,
    resolvers: app.resolvers,
    features: { filters: { String: { MATCHES: true } }, subscriptions: true },
  });
  initializeOgmFromExistingSchema(ogm, neoSchema, await neoSchema.getSchema());
  standaloneOgm = createOgmPersistence(driver).ogm;
  await standaloneOgm.init();
}, { timeout: 240_000 });

beforeEach(async () => resetDatabase(driver));
after(async () => stopNeo4j());

const seedFile = async () => {
  await driver.executeQuery(`
    CREATE (file:DownloadableFile {
      id: "file", url: "https://example.test/stored.zip", scanStatus: "CLEAN",
      uploadedByUsername: "uploader", fileName: "stored.zip"
    })
    CREATE (author:User {username: "author"})
    CREATE (discussion:Discussion {id: "discussion"})
    CREATE (discussion)-[:HAS_DOWNLOADABLE_FILE]->(file)
    CREATE (author)-[:POSTED_DISCUSSION]->(discussion)
  `);
};

const findFileAccess = (models: typeof ogm) =>
  models.model("DownloadableFile").find({
    where: { id: "file" },
    selectionSet: `{
      url scanStatus uploadedByUsername Discussion { Author { username } }
    }`,
  });

// Reference for the pre-migration resolver after authentication, using its exact
// old OGM selection and fallback. This deliberately tests production schema
// execution, not the authorization-stripping standalone OGM test harness.
const legacyAuthorizedUrl = async (
  models: typeof ogm,
  parent: { id: string; url?: string },
  username: string,
  canReview = false
) => {
  const file = (await findFileAccess(models))[0];
  if (!file) return "";
  const isOwner = file.uploadedByUsername === username ||
    file.Discussion?.Author?.username === username;
  return isOwner || canReview === true ? file.url || parent.url || "" : "";
};

test("production OGM resolves the selected URL anonymously; standalone OGM returns storage data", async () => {
  await seedFile();
  const records = await findFileAccess(ogm);
  assert.deepEqual(JSON.parse(JSON.stringify(records)), [{
    url: "",
    scanStatus: "CLEAN",
    uploadedByUsername: "uploader",
    Discussion: { Author: { username: "author" } },
  }]);
  const standaloneRecords = await findFileAccess(standaloneOgm);
  assert.equal(standaloneRecords[0]?.url, "https://example.test/stored.zip");
});

test("the existing URL resolver returns parent URL in production but stored URL with standalone OGM", async () => {
  await seedFile();
  const resolveUrl = createDownloadableFileUrlResolver(
    async () => { throw new Error("preloaded identity must be reused"); },
    async () => false
  );
  const context = {
    driver,
    ogm,
    user: {
      username: "uploader", email: null, email_verified: false, data: null,
    },
  } as GraphQLContext;
  const parent = { id: "file", url: "https://example.test/parent.zip" };

  assert.equal(await resolveUrl(parent, {}, context), parent.url);
  assert.equal(await resolveUrl({ id: "file" }, {}, context), "");
  assert.equal(
    await legacyAuthorizedUrl(standaloneOgm, parent, "uploader"),
    "https://example.test/stored.zip"
  );
  assert.equal(await resolveUrl(parent, {}, context), await legacyAuthorizedUrl(ogm, parent, "uploader"));
});

test("production OGM filters restricted files without inheriting the caller's age claim", async () => {
  await seedFile();
  await driver.executeQuery(`
    MATCH (file:DownloadableFile {id: "file"}) SET file.ageGateRestricted = true
  `);
  assert.deepEqual(await findFileAccess(ogm), []);
  assert.equal((await findFileAccess(standaloneOgm)).length, 1);
  const resolveUrl = createDownloadableFileUrlResolver(
    async () => { throw new Error("preloaded identity must be reused"); },
    async () => true
  );
  const context = {
    driver,
    ogm,
    jwt: { mayAccessSensitiveContent: true },
    user: {
      username: "uploader", email: null, email_verified: false, data: null,
    },
  } as GraphQLContext;
  assert.equal(
    await resolveUrl({ id: "file", url: "https://example.test/parent.zip" }, {}, context),
    ""
  );
});

test("production OGM filters a sensitive discussion out of the file access projection", async () => {
  await seedFile();
  await driver.executeQuery(`
    MATCH (discussion:Discussion {id: "discussion"})
    SET discussion.hasSensitiveContent = true
  `);
  const records = await findFileAccess(ogm);
  assert.equal(records[0]?.Discussion, null);
  assert.equal(
    (await findFileAccess(standaloneOgm))[0]?.Discussion?.Author?.username,
    "author"
  );
});

test("migrated URL decisions match production OGM for file and discussion visibility", async () => {
  await seedFile();
  for (const fileRestricted of [null, false, true]) {
    for (const discussionSensitive of [null, false, true]) {
      await driver.executeQuery(`
        MATCH (file:DownloadableFile {id: "file"})
        MATCH (discussion:Discussion {id: "discussion"})
        SET file.ageGateRestricted = $fileRestricted,
            discussion.hasSensitiveContent = $discussionSensitive
      `, { fileRestricted, discussionSensitive });
      for (const username of ["uploader", "author", "moderator", "stranger"]) {
        const canReview = username === "moderator";
        const resolveUrl = createDownloadableFileUrlResolver(
          async () => { throw new Error("identity is already available"); },
          async () => canReview
        );
        for (const url of [undefined, "https://example.test/parent.zip"]) {
          const parent = { id: "file", url };
          const context = {
            driver, ogm,
            // Old context-free OGM calls never inherited this claim.
            jwt: { mayAccessSensitiveContent: true },
            user: { username, email: null, email_verified: false, data: null },
          } as GraphQLContext;
          assert.equal(await resolveUrl(parent, {}, context),
            await legacyAuthorizedUrl(ogm, parent, username, canReview),
            JSON.stringify({ fileRestricted, discussionSensitive, username, url }));
        }
      }
    }
  }
});

test("missing files, absent relationships, and invalid selected values retain production outcomes", async () => {
  const repository = createDownloadableFileRepository(driver);
  assert.equal(await repository.findUrlAccess("missing"), null);
  await seedFile();
  await driver.executeQuery("MATCH (discussion:Discussion) DETACH DELETE discussion");
  assert.deepEqual(await repository.findUrlAccess("file"), {
    uploadedByUsername: "uploader", discussionAuthorUsername: null,
  });
  for (const scanStatus of [null, "INVALID"]) {
    await driver.executeQuery(`
      MATCH (file:DownloadableFile {id: "file"}) SET file.scanStatus = $scanStatus
    `, { scanStatus });
    const oldError = await findFileAccess(ogm).then(() => null, (error: Error) => error.message);
    const newError = await repository.findUrlAccess("file").then(() => null, (error: Error) => error.message);
    assert.ok(oldError);
    assert.equal(newError, oldError);
  }
});

test("access lookup observes request writes through the shared bookmark manager", async () => {
  await runWithRequestBookmarks(async () => {
    await seedFile();
    const bookmarks = await getRequestBookmarkManager()?.getBookmarks();
    assert.ok(bookmarks && Array.from(bookmarks).length > 0);
    const repository = createDownloadableFileRepository(driver);
    assert.equal((await repository.findUrlAccess("file"))?.uploadedByUsername, "uploader");
    await driver.executeQuery(`
      MATCH (file:DownloadableFile {id: "file"}) SET file.ageGateRestricted = true
    `);
    assert.equal(await repository.findUrlAccess("file"), null);
  });
});

test("attachment metadata matches the production OGM projection and hidden-file outcome", async () => {
  await seedFile();
  const repository = createDownloadableFileRepository(driver);
  const legacyMetadata = async (id: string) => {
    const rows = await ogm.model("DownloadableFile").find({
      where: { id }, selectionSet: "{ id fileName }",
    });
    return rows[0] ? JSON.parse(JSON.stringify(rows[0])) : null;
  };
  assert.equal(await repository.findAttachmentMetadata("missing"), await legacyMetadata("missing"));
  for (const restricted of [null, false, true]) {
    for (const fileName of ["archive.zip", ""]) {
      await driver.executeQuery(`
        MATCH (file:DownloadableFile {id: "file"})
        SET file.ageGateRestricted = $restricted, file.fileName = $fileName,
            file.scanStatus = null
      `, { restricted, fileName });
      assert.deepEqual(await repository.findAttachmentMetadata("file"), await legacyMetadata("file"));
      const context = {
        driver, ogm, jwt: { mayAccessSensitiveContent: true },
        contentFeaturePolicyRepository: {
          findChannelPolicy: async () => ({ found: true, allowedFileTypes: ["zip"] }),
          findServerFileTypePolicy: async () => ({ found: true, allowedFileTypes: ["zip"] }),
        },
      } as unknown as GraphQLContext;
      const input = {
        discussionInput: {
          DownloadableFiles: { connect: [{ where: { node: { id: "file" } } }] },
        },
        channelConnections: ["cats"],
      };
      const oldContext = {
        ...context,
        downloadableFileRepository: { ...repository, findAttachmentMetadata: legacyMetadata },
      };
      assert.equal(await validateDiscussionDownloadPreferences(input, context),
        await validateDiscussionDownloadPreferences(input, oldContext));
    }
  }
  await driver.executeQuery(`
    MATCH (file:DownloadableFile {id: "file"})
    SET file.ageGateRestricted = false, file.fileName = null
  `);
  const previousError = await legacyMetadata("file").then(() => null, (error: Error) => error.message);
  const currentError = await repository.findAttachmentMetadata("file").then(() => null, (error: Error) => error.message);
  assert.equal(currentError, previousError);
  assert.ok(currentError);
});
