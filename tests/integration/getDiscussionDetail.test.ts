import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import {
  resetDb,
  run,
  startImageModEnv,
  stopImageModEnv,
  type ImageModEnv,
} from "./imageModerationHarness.js";
import type { GraphQLContext } from "../../types/context.js";

let env: ImageModEnv;

before(async () => {
  env = await startImageModEnv();
}, { timeout: 240000 });

after(async () => {
  await stopImageModEnv();
});

beforeEach(async () => {
  await resetDb();
});

const anonymousContext = (): GraphQLContext => ({
  driver: env.driver,
  ogm: env.ogm,
  req: { headers: {}, body: {} } as GraphQLContext["req"],
});

test("getDiscussionDetail returns only the requested channel and bounded viewer lists", async () => {
  await run(`
    CREATE (author:User {username: 'author', displayName: 'Author', createdAt: datetime()})
    CREATE (viewer:User {username: 'viewer', createdAt: datetime()})
    CREATE (channel:Channel {uniqueName: 'cats', displayName: 'Cats', createdAt: datetime()})
    CREATE (otherChannel:Channel {uniqueName: 'dogs', displayName: 'Dogs', createdAt: datetime()})
    CREATE (discussion:Discussion {id: 'discussion-1', title: 'Hello', body: 'Body', createdAt: datetime(), hasSensitiveContent: false})
    CREATE (entry:DiscussionChannel {id: 'entry-1', discussionId: 'discussion-1', channelUniqueName: 'cats', createdAt: datetime()})
    CREATE (otherEntry:DiscussionChannel {id: 'entry-2', discussionId: 'discussion-1', channelUniqueName: 'dogs', createdAt: datetime()})
    CREATE (author)-[:POSTED_DISCUSSION]->(discussion)
    CREATE (entry)-[:POSTED_IN_CHANNEL]->(discussion)
    CREATE (entry)-[:POSTED_IN_CHANNEL]->(channel)
    CREATE (otherEntry)-[:POSTED_IN_CHANNEL]->(discussion)
    CREATE (otherEntry)-[:POSTED_IN_CHANNEL]->(otherChannel)
    CREATE (viewer)-[:UPVOTED_DISCUSSION]->(entry)
    CREATE (:User {username: 'another-voter'})-[:UPVOTED_DISCUSSION]->(entry)
  `);

  const context = anonymousContext();
  context.user = {
    username: "viewer",
    email: null,
    email_verified: true,
    data: null,
  };
  const result = await env.resolvers.Query.getDiscussionDetail(
    null,
    { discussionId: "discussion-1", channelUniqueName: "cats" },
    context
  );
  const discussion = result[0];

  assert.deepEqual(
    {
      id: discussion?.id,
      channels: discussion?.DiscussionChannels.map((entry: Record<string, unknown>) => ({
        id: entry.id,
        upvoters: entry.UpvotedByUsers,
        count: Number((entry.UpvotedByUsersAggregate as { count: number }).count),
      })),
    },
    {
      id: "discussion-1",
      channels: [
        { id: "entry-1", upvoters: [{ username: "viewer" }], count: 2 },
      ],
    }
  );
});

test("getDiscussionDetail hides sensitive discussions from an ineligible viewer", async () => {
  await run(`
    CREATE (:Discussion {
      id: 'sensitive-1',
      title: 'Hidden',
      createdAt: datetime(),
      hasSensitiveContent: true
    })
  `);
  const context = anonymousContext();
  context.mayAccessSensitiveContent = false;

  const result = await env.resolvers.Query.getDiscussionDetail(
    null,
    { discussionId: "sensitive-1", channelUniqueName: "cats" },
    context
  );

  assert.deepEqual(result, []);
});

test("detail collections continue from the bounded first page without gaps", async () => {
  await run(`
    CREATE (author:User {username: 'author', displayName: 'Author', createdAt: datetime()})
    CREATE (channel:Channel {uniqueName: 'cats', displayName: 'Cats', createdAt: datetime()})
    CREATE (discussion:Discussion {id: 'discussion-1', title: 'Hello', createdAt: datetime(), hasSensitiveContent: false})
    CREATE (entry:DiscussionChannel {id: 'entry-1', discussionId: 'discussion-1', channelUniqueName: 'cats', createdAt: datetime()})
    CREATE (album:Album {id: 'album-1'})
    CREATE (author)-[:POSTED_DISCUSSION]->(discussion)
    CREATE (entry)-[:POSTED_IN_CHANNEL]->(discussion)
    CREATE (entry)-[:POSTED_IN_CHANNEL]->(channel)
    CREATE (discussion)-[:HAS_ALBUM]->(album)
    WITH author, discussion, entry, album
    UNWIND range(1, 14) AS n
    CREATE (image:Image {
      id: 'image-' + right('00' + toString(n), 2),
      createdAt: datetime('2026-01-01T00:00:00Z'),
      url: 'https://example.com/image-' + toString(n) + '.jpg',
      archived: false,
      permanentlyRemoved: false,
      hasSensitiveContent: false
    })
    CREATE (album)-[:HAS_IMAGE]->(image)
    CREATE (author)-[:UPLOADED_IMAGE]->(image)
    WITH DISTINCT author, discussion, entry
    UNWIND range(1, 14) AS n
    CREATE (file:DownloadableFile {
      id: 'file-' + right('00' + toString(n), 2),
      createdAt: datetime('2026-01-01T00:00:00Z'),
      fileName: 'file-' + toString(n) + '.stl',
      url: 'https://example.com/file-' + toString(n) + '.stl',
      permanentlyRemoved: false,
      ageGateRestricted: false
    })
    CREATE (discussion)-[:HAS_DOWNLOADABLE_FILE]->(file)
    WITH DISTINCT author, entry
    UNWIND range(1, 7) AS n
    CREATE (answer:Comment {
      id: 'answer-' + right('00' + toString(n), 2),
      text: 'Answer ' + toString(n),
      createdAt: datetime('2026-01-01T00:00:00Z'),
      ageGateRestricted: false
    })
    CREATE (author)-[:AUTHORED_COMMENT]->(answer)
    CREATE (answer)-[:IS_REPLY_TO]->(entry)
  `);

  const context = anonymousContext();
  context.mayAccessSensitiveContent = false;
  const [discussion] = await env.resolvers.Query.getDiscussionDetail(
    null,
    { discussionId: "discussion-1", channelUniqueName: "cats" },
    context
  );
  const entry = discussion.DiscussionChannels[0];
  const album = discussion.Album;
  const answerPageInfo = env.resolvers.DiscussionChannel.detailAnswersPageInfo(entry);
  const imagePageInfo = env.resolvers.Album.detailImagesPageInfo(album);
  const filePageInfo = env.resolvers.Discussion.detailFilesPageInfo(discussion);

  const answerPage = await env.resolvers.Query.getDiscussionDetailAnswers(
    null,
    {
      discussionId: "discussion-1",
      channelUniqueName: "cats",
      after: answerPageInfo.endCursor,
    },
    context
  );
  const imagePage = await env.resolvers.Query.getDiscussionDetailImages(
    null,
    {
      discussionId: "discussion-1",
      channelUniqueName: "cats",
      after: imagePageInfo.endCursor,
    },
    context
  );
  const filePage = await env.resolvers.Query.getDiscussionDetailFiles(
    null,
    {
      discussionId: "discussion-1",
      channelUniqueName: "cats",
      after: filePageInfo.endCursor,
    },
    context
  );

  assert.deepEqual(
    {
      answers: [...entry.Answers, ...answerPage.answers].map(
        (item: { id: string }) => item.id
      ),
      images: [...album.Images, ...imagePage.images].map(
        (item: { id: string }) => item.id
      ),
      files: [...discussion.DownloadableFiles, ...filePage.files].map(
        (item: { id: string }) => item.id
      ),
      hasNextPage: {
        answers: answerPage.pageInfo.hasNextPage,
        images: imagePage.pageInfo.hasNextPage,
        files: filePage.pageInfo.hasNextPage,
      },
    },
    {
      answers: Array.from({ length: 7 }, (_, index) =>
        `answer-${String(index + 1).padStart(2, "0")}`
      ),
      images: Array.from({ length: 14 }, (_, index) =>
        `image-${String(index + 1).padStart(2, "0")}`
      ),
      files: Array.from({ length: 14 }, (_, index) =>
        `file-${String(index + 1).padStart(2, "0")}`
      ),
      hasNextPage: { answers: false, images: false, files: false },
    }
  );
});
