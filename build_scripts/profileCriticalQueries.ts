import fs from "node:fs/promises";
import path from "node:path";
import { Neo4jContainer, type StartedNeo4jContainer } from "@testcontainers/neo4j";
import neo4j, { type Driver, type ProfiledPlan } from "neo4j-driver";
import { buildSiteWideDiscussionPageQueries } from "../customResolvers/cypher/buildSiteWideDiscussionPageQueries.js";
import {
  getCommentRepliesQuery,
  getCommentsQuery,
  getDiscussionChannelsQuery,
  getDiscussionDetailCoreQuery,
  getDiscussionDetailFilesQuery,
} from "../customResolvers/cypher/cypherQueries.js";
import {
  evaluateProfile,
  renderPerformanceReport,
  summarizeProfile,
  type PerformanceBudget,
  type ProfilePlan,
  type ProfileResult,
} from "../services/cypherPerformanceBudget.js";

const FIXTURE = {
  users: 250,
  channels: 4,
  discussions: 2_000,
  downloads: 2_000,
  images: 4_000,
  comments: 20_000,
  commentVotes: 40_000,
  discussionVotes: 20_000,
} as const;

const PAGE_SIZE = 20;
const LARGE_PAGE_SIZE = 50;
const FIXTURE_EPOCH_MILLIS = Date.UTC(2026, 0, 1);

type QuerySpec = {
  name: string;
  description: string;
  query: string;
  parameters: Record<string, unknown>;
  budget: Omit<PerformanceBudget, "requestedRows">;
  requestedRows: number;
};

const parseOutputPaths = () => {
  const options = new Map<string, string>();
  for (let index = 2; index < process.argv.length; index += 1) {
    const argument = process.argv[index];
    const value = process.argv[index + 1];
    if ((argument === "--json" || argument === "--markdown") && value) {
      options.set(argument, value);
      index += 1;
    }
  }
  return {
    json: options.get("--json") ?? "performance-results/cypher-profile.json",
    markdown:
      options.get("--markdown") ?? "performance-results/cypher-profile.md",
  };
};

const schemaStatements = [
  "CREATE CONSTRAINT performance_discussion_id IF NOT EXISTS FOR (n:Discussion) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT performance_discussion_channel_id IF NOT EXISTS FOR (n:DiscussionChannel) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT performance_comment_id IF NOT EXISTS FOR (n:Comment) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT performance_user_username IF NOT EXISTS FOR (n:User) REQUIRE n.username IS UNIQUE",
  "CREATE CONSTRAINT performance_channel_name IF NOT EXISTS FOR (n:Channel) REQUIRE n.uniqueName IS UNIQUE",
  "CREATE CONSTRAINT performance_album_id IF NOT EXISTS FOR (n:Album) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT performance_image_id IF NOT EXISTS FOR (n:Image) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT performance_file_id IF NOT EXISTS FOR (n:DownloadableFile) REQUIRE n.id IS UNIQUE",
  "CREATE RANGE INDEX performance_discussion_created_at IF NOT EXISTS FOR (n:Discussion) ON (n.createdAt)",
  "CREATE RANGE INDEX performance_discussion_channel_name IF NOT EXISTS FOR (n:DiscussionChannel) ON (n.channelUniqueName)",
] as const;

const seedStatements = [
  `UNWIND range(0, $users - 1) AS i
   CREATE (:User {
     username: 'user-' + toString(i), displayName: 'User ' + toString(i),
     createdAt: datetime({epochMillis: $epochMillis - i * 1000}),
     discussionKarma: i, commentKarma: i
   })`,
  `UNWIND range(0, $channels - 1) AS i
   CREATE (:Channel {
     uniqueName: 'channel-' + toString(i), displayName: 'Channel ' + toString(i),
     feedbackEnabled: true, imageUploadsEnabled: true,
     markdownImagesEnabled: true, emojiEnabled: true
   })`,
  `UNWIND range(0, $discussions - 1) AS i
   MATCH (author:User {username: 'user-' + toString(i % $users)})
   MATCH (channel:Channel {uniqueName: 'channel-' + toString(i % $channels)})
   CREATE (discussion:Discussion {
     id: 'discussion-' + toString(i), title: 'Discussion ' + toString(i),
     body: 'Deterministic performance fixture',
     createdAt: datetime({epochMillis: $epochMillis - i * 60000}),
     updatedAt: datetime({epochMillis: $epochMillis - i * 60000}),
     hasDownload: true, hasSensitiveContent: false, hasSpoiler: false
   })
   CREATE (entry:DiscussionChannel {
     id: 'discussion-channel-' + toString(i),
     discussionId: discussion.id, channelUniqueName: channel.uniqueName,
     createdAt: discussion.createdAt, weightedVotesCount: i % 100,
     archived: false, answered: false, locked: false
   })
   CREATE (author)-[:POSTED_DISCUSSION]->(discussion)
   CREATE (entry)-[:POSTED_IN_CHANNEL]->(discussion)
   CREATE (entry)-[:POSTED_IN_CHANNEL]->(channel)`,
  `UNWIND range(0, $discussions - 1) AS i
   MATCH (discussion:Discussion {id: 'discussion-' + toString(i)})
   CREATE (album:Album {id: 'album-' + toString(i), imageOrder: []})
   CREATE (discussion)-[:HAS_ALBUM]->(album)`,
  `UNWIND range(0, $images - 1) AS i
   MATCH (album:Album {id: 'album-' + toString(i % $discussions)})
   MATCH (uploader:User {username: 'user-' + toString(i % $users)})
   CREATE (image:Image {
     id: 'image-' + toString(i), url: 'https://example.invalid/image-' + toString(i),
     createdAt: datetime({epochMillis: $epochMillis - i * 1000}),
     archived: false, permanentlyRemoved: false, hasSensitiveContent: false
   })
   CREATE (album)-[:HAS_IMAGE]->(image)
   CREATE (uploader)-[:UPLOADED_IMAGE]->(image)`,
  `UNWIND range(0, $downloads - 1) AS i
   MATCH (discussion:Discussion {id: 'discussion-' + toString(i % $discussions)})
   CREATE (file:DownloadableFile {
     id: 'file-' + toString(i), fileName: 'file-' + toString(i) + '.zip',
     url: 'https://example.invalid/file-' + toString(i), kind: 'ARCHIVE', size: 1024,
     createdAt: datetime({epochMillis: $epochMillis - i * 1000}),
     permanentlyRemoved: false, ageGateRestricted: false, scanStatus: 'CLEAN'
   })
   CREATE (discussion)-[:HAS_DOWNLOADABLE_FILE]->(file)`,
  `UNWIND range(0, $comments - 1) AS i
   WITH i, CASE WHEN i < 2000 THEN 0 ELSE i % $discussions END AS discussionIndex
   MATCH (entry:DiscussionChannel {id: 'discussion-channel-' + toString(discussionIndex)})
   MATCH (author:User {username: 'user-' + toString(i % $users)})
   CREATE (comment:Comment {
     id: 'comment-' + toString(i), text: 'Comment ' + toString(i),
     createdAt: datetime({epochMillis: $epochMillis - i * 1000}),
     updatedAt: datetime({epochMillis: $epochMillis - i * 1000}),
     weightedVotesCount: i % 50, isRootComment: i >= 2000 OR i < 50,
     isFeedbackComment: false, archived: false, isSticky: false
   })
   CREATE (entry)-[:CONTAINS_COMMENT]->(comment)
   CREATE (author)-[:AUTHORED_COMMENT]->(comment)`,
  `UNWIND range(50, 1999) AS i
   MATCH (child:Comment {id: 'comment-' + toString(i)})
   MATCH (parent:Comment {id: 'comment-' + toString(i % 50)})
   CREATE (child)-[:IS_REPLY_TO]->(parent)`,
  `UNWIND range(0, $commentVotes - 1) AS i
   MATCH (user:User {username: 'user-' + toString(i % $users)})
   MATCH (comment:Comment {id: 'comment-' + toString(i % $comments)})
   CREATE (user)-[:UPVOTED_COMMENT]->(comment)`,
  `UNWIND range(0, $discussionVotes - 1) AS i
   MATCH (user:User {username: 'user-' + toString(i % $users)})
   MATCH (entry:DiscussionChannel {id: 'discussion-channel-' + toString(i % $discussions)})
   CREATE (user)-[:UPVOTED_DISCUSSION]->(entry)`,
] as const;

const runStatements = async (
  driver: Driver,
  statements: readonly string[],
  parameters: Record<string, unknown>
) => {
  const session = driver.session({ defaultAccessMode: neo4j.session.WRITE });
  try {
    for (const statement of statements) {
      const result = session.run(statement, parameters);
      await result.summary();
    }
  } finally {
    await session.close();
  }
};

const seedFixture = async (driver: Driver) => {
  await runStatements(driver, schemaStatements, {});
  await runStatements(driver, ["CALL db.awaitIndexes(300)"], {});
  const fixtureParameters = Object.fromEntries(
    Object.entries(FIXTURE).map(([name, value]) => [name, neo4j.int(value)])
  );
  await runStatements(driver, seedStatements, {
    ...fixtureParameters,
    epochMillis: neo4j.int(FIXTURE_EPOCH_MILLIS),
  });
  const verifyCount = async (label: string, expected: number) => {
    const verification = await driver.executeQuery(
      `MATCH (n:\`${label}\`)
       RETURN count(n) = $expected AS matches, toString(count(n)) AS actual`,
      { expected }
    );
    const record = verification.records[0];
    if (record?.get("matches") !== true) {
      throw new Error(
        `fixture verification failed for ${label}: expected ${expected}, got ${record?.get("actual") ?? "no result"}`
      );
    }
  };
  await verifyCount("Discussion", FIXTURE.discussions);
  await verifyCount("Comment", FIXTURE.comments);
  await verifyCount("DownloadableFile", FIXTURE.downloads);
};

const pageIds = (size: number) =>
  Array.from(
    { length: size },
    (_, index) => `discussion-channel-${index + 100}`
  );

const commonHydrationParameters = {
  loggedInUsername: "user-0",
  mayAccessSensitiveContent: true,
  showArchived: false,
  selectedChannels: [],
};

const querySpecs = (): QuerySpec[] => {
  const initialPage = buildSiteWideDiscussionPageQueries({
    hasDownload: null,
    hasSearch: false,
    hasSelectedChannels: false,
    hasSelectedTags: false,
    showArchived: false,
    sortOption: "new",
    paginationMode: "initial",
  }).pageQuery;
  const deepPage = buildSiteWideDiscussionPageQueries({
    hasDownload: null,
    hasSearch: false,
    hasSelectedChannels: false,
    hasSelectedTags: false,
    showArchived: false,
    sortOption: "new",
    paginationMode: "cursor",
  }).pageQuery;
  const listBudget = {
    baseDbHits: 1_000,
    dbHitsPerRequestedRow: 450,
    baseIntermediateRows: 100,
    intermediateRowsPerRequestedRow: 20,
  };

  return [
    {
      name: "channel-list-hydration-20",
      description: "Hydrate a normal channel discussion page",
      query: getDiscussionChannelsQuery,
      parameters: {
        ...commonHydrationParameters,
        discussionChannelIds: pageIds(PAGE_SIZE),
      },
      requestedRows: PAGE_SIZE,
      budget: listBudget,
    },
    {
      name: "channel-list-hydration-50",
      description: "Verify list work grows with requested page size",
      query: getDiscussionChannelsQuery,
      parameters: {
        ...commonHydrationParameters,
        discussionChannelIds: pageIds(LARGE_PAGE_SIZE),
      },
      requestedRows: LARGE_PAGE_SIZE,
      budget: listBudget,
    },
    {
      name: "site-wide-new-initial",
      description: "Select the first site-wide cursor page",
      query: initialPage,
      parameters: {
        mayAccessSensitiveContent: true,
        pageLimit: PAGE_SIZE,
      },
      requestedRows: PAGE_SIZE,
      budget: {
        baseDbHits: 23_000,
        dbHitsPerRequestedRow: 50,
        baseIntermediateRows: 2_200,
        intermediateRowsPerRequestedRow: 10,
        allowedOperators: ["NodeByLabelScan"],
      },
    },
    {
      name: "site-wide-new-deep-cursor",
      description: "Select a page after 75% of the fixture",
      query: deepPage,
      parameters: {
        mayAccessSensitiveContent: true,
        pageLimit: PAGE_SIZE,
        cursorCreatedAt: new Date(
          FIXTURE_EPOCH_MILLIS - 1_500 * 60_000
        ).toISOString(),
        cursorDiscussionId: "discussion-1500",
      },
      requestedRows: PAGE_SIZE,
      budget: {
        baseDbHits: 4_400,
        dbHitsPerRequestedRow: 50,
        baseIntermediateRows: 400,
        intermediateRowsPerRequestedRow: 10,
      },
    },
    {
      name: "discussion-detail-core",
      description: "Load the bounded core discussion detail",
      query: getDiscussionDetailCoreQuery,
      parameters: {
        discussionId: "discussion-0",
        mayAccessSensitiveContent: true,
        imageLimit: PAGE_SIZE,
        previewImageLimit: 3,
        viewerModName: null,
        viewerUsername: "user-0",
      },
      requestedRows: PAGE_SIZE,
      budget: {
        baseDbHits: 150,
        dbHitsPerRequestedRow: 10,
        baseIntermediateRows: 10,
        intermediateRowsPerRequestedRow: 2,
      },
    },
    {
      name: "discussion-detail-files",
      description: "Load a bounded downloadable-file detail page",
      query: getDiscussionDetailFilesQuery,
      parameters: {
        discussionId: "discussion-0",
        mayAccessSensitiveContent: true,
        fileLimit: PAGE_SIZE,
      },
      requestedRows: PAGE_SIZE,
      budget: {
        baseDbHits: 50,
        dbHitsPerRequestedRow: 5,
        baseIntermediateRows: 10,
        intermediateRowsPerRequestedRow: 2,
      },
    },
    {
      name: "root-comments-page",
      description: "Load root comments without expanding the full section",
      query: getCommentsQuery,
      parameters: {
        discussionChannelId: "discussion-channel-0",
        modName: null,
        offset: 0,
        limit: PAGE_SIZE,
        sortOption: "new",
        loggedInUsername: "user-0",
        hotAgeOffsetMonths: 2,
        hotGravity: 1.8,
      },
      requestedRows: PAGE_SIZE,
      budget: {
        baseDbHits: 14_000,
        dbHitsPerRequestedRow: 200,
        baseIntermediateRows: 2_100,
        intermediateRowsPerRequestedRow: 20,
      },
    },
    {
      name: "comment-replies-page",
      description: "Load one bounded page of replies",
      query: getCommentRepliesQuery,
      parameters: {
        commentId: "comment-0",
        modName: null,
        offset: 0,
        limit: PAGE_SIZE,
        sortOption: "new",
        loggedInUsername: "user-0",
        hotAgeOffsetMonths: 2,
        hotGravity: 1.8,
      },
      requestedRows: PAGE_SIZE,
      budget: {
        baseDbHits: 1_500,
        dbHitsPerRequestedRow: 100,
        baseIntermediateRows: 50,
        intermediateRowsPerRequestedRow: 5,
      },
    },
  ];
};

const profileQuery = async (
  driver: Driver,
  spec: QuerySpec
): Promise<ProfileResult> => {
  const routing = { routing: neo4j.routing.READ } as const;
  await driver.executeQuery(`EXPLAIN\n${spec.query}`, spec.parameters, routing);
  const coldResult = await driver.executeQuery(
    `PROFILE\n${spec.query}`,
    spec.parameters,
    routing
  );
  const warmResult = await driver.executeQuery(
    `PROFILE\n${spec.query}`,
    spec.parameters,
    routing
  );
  if (!coldResult.summary.profile || !warmResult.summary.profile) {
    throw new Error(`${spec.name} did not return a PROFILE plan`);
  }
  const cold = summarizeProfile(
    coldResult.summary.profile as ProfiledPlan as ProfilePlan,
    coldResult.records.length
  );
  const warm = summarizeProfile(
    warmResult.summary.profile as ProfiledPlan as ProfilePlan,
    warmResult.records.length
  );
  return {
    name: spec.name,
    description: spec.description,
    requestedRows: spec.requestedRows,
    cold,
    warm,
    evaluation: evaluateProfile(warm, {
      ...spec.budget,
      requestedRows: spec.requestedRows,
    }),
  };
};

const writeReports = async (results: ProfileResult[]) => {
  const outputPaths = parseOutputPaths();
  const generatedAt = new Date().toISOString();
  const report = {
    generatedAt,
    fixture: FIXTURE,
    results,
    passed: results.every((result) => result.evaluation.passed),
  };
  await Promise.all([
    fs.mkdir(path.dirname(outputPaths.json), { recursive: true }),
    fs.mkdir(path.dirname(outputPaths.markdown), { recursive: true }),
  ]);
  await Promise.all([
    fs.writeFile(outputPaths.json, `${JSON.stringify(report, null, 2)}\n`),
    fs.writeFile(
      outputPaths.markdown,
      renderPerformanceReport(generatedAt, FIXTURE, results)
    ),
  ]);
  process.stdout.write(renderPerformanceReport(generatedAt, FIXTURE, results));
  if (!report.passed) {
    process.exitCode = 1;
  }
};

const main = async () => {
  let container: StartedNeo4jContainer | undefined;
  let driver: Driver | undefined;
  try {
    container = await new Neo4jContainer(
      process.env.NEO4J_TEST_IMAGE || "neo4j:5-community"
    ).start();
    driver = neo4j.driver(
      container.getBoltUri(),
      neo4j.auth.basic(container.getUsername(), container.getPassword())
    );
    await driver.getServerInfo();
    await seedFixture(driver);
    const results: ProfileResult[] = [];
    for (const spec of querySpecs()) {
      results.push(await profileQuery(driver, spec));
    }
    await writeReports(results);
  } finally {
    await driver?.close();
    await container?.stop();
  }
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`Cypher performance profiling failed: ${message}\n`);
  process.exitCode = 1;
});
