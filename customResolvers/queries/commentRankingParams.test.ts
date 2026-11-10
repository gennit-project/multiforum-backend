import {int} from "neo4j-driver";
import type {CustomCommentSectionChannel} from "../contracts/customCommentSources.js";
import assert from "node:assert/strict";
import test from "node:test";
import type { GraphQLContext } from "../../types/context.js";
import getCommentReplies from "./getCommentReplies.js";
import getCommentSection from "./getCommentSection.js";
import getEventComments from "./getEventComments.js";

const settingsJson = JSON.stringify({
  version: 1,
  discussionHot: {
    ageOffsetMonths: 2,
    gravity: 1.8,
  },
  commentHot: {
    ageOffsetMonths: 0.5,
    gravity: 2.25,
  },
});

const createDriver = () => {
  const runCalls: Array<{
    query: string;
    params: Record<string, unknown>;
  }> = [];

  return {
    runCalls,
    driver: {
      session: () => {
        const run = async (query: string, params: Record<string, unknown>) => {
          runCalls.push({ query, params });
          if (query.includes("RETURN serverConfig.rankingSettingsJson")) {
            return {
              records: [
                {
                  get: (key: string) =>
                    key === "settingsJson" ? settingsJson : null,
                },
              ],
            };
          }
          if (query.includes("AS DiscussionChannel")) {
            assert.ok(typeof params.discussionId === "string");
            assert.ok(typeof params.channelUniqueName === "string");
            const count={count:int(0)};
            const connection={totalCount:int(0),aggregate:{count:{nodes:int(0)}}};
            const channel={id:"discussion-channel-1",weightedVotesCount:0,discussionId:params.discussionId,
              channelUniqueName:params.channelUniqueName,emoji:null,archived:null,locked:null,answered:null,
              UpvotedByUsers:[],UpvotedByUsersAggregate:count,UpvotedByUsersConnection:connection,
              SuperUpvotedByUsers:[],CommentsAggregate:count,CommentsConnection:connection,
              RootCommentsAggregate:count,RootCommentsConnection:connection,SubscribedToNotifications:[],
              Answers:[],_detailAnswersHasNextPage:false,
              Channel:{uniqueName:params.channelUniqueName,feedbackEnabled:null,imageUploadsEnabled:null,
                markdownImagesEnabled:null,emojiEnabled:null,Bots:[],Moderators:[]},
              Discussion:{id:params.discussionId,title:null,Author:null},
            } satisfies CustomCommentSectionChannel;
            return { records: [{ get: () => channel }] };
          }
          if (query.includes("AS Event")) {
            return {
              records: [{ get: () => ({ id: "event-1" }) }],
            };
          }
          return { records: [] };
        };
        return {
          run,
          executeWrite: async (work: (transaction: { run: typeof run }) => unknown) =>
            work({ run }),
          close: async () => {},
        };
      },
    },
  };
};

const context = {
  user: {
    username: "test-user",
  },
} as GraphQLContext;

const assertCommentRankingParams = (
  runCalls: Array<{ params: Record<string, unknown> }>
) => {
  const rankingCall = runCalls.find(
    (call) => call.params.sortOption === "hot"
  );
  assert.ok(rankingCall);
  assert.equal(rankingCall.params.hotAgeOffsetMonths, 0.5);
  assert.equal(rankingCall.params.hotGravity, 2.25);
};

test("getCommentSection passes stored comment ranking settings to Cypher", async () => {
  const mock = createDriver();
  const resolver = getCommentSection({
    driver: mock.driver as never,
    serverName: "test-server",
  });

  await resolver(
    null,
    {
      channelUniqueName: "general",
      discussionId: "discussion-1",
      modName: "",
      offset: "0",
      limit: "20",
      sort: "hot",
    },
    context,
    null as never
  );

  assertCommentRankingParams(mock.runCalls);
});

test("getEventComments passes stored comment ranking settings to Cypher", async () => {
  const mock = createDriver();
  const resolver = getEventComments({
    driver: mock.driver as never,
    serverName: "test-server",
  });

  await resolver(
    null,
    {
      eventId: "event-1",
      offset: "0",
      limit: "20",
      sort: "hot",
    },
    context,
    null as never
  );

  assertCommentRankingParams(mock.runCalls);
});

test("getCommentReplies passes stored comment ranking settings to Cypher", async () => {
  const mock = createDriver();
  const resolver = getCommentReplies({
    driver: mock.driver as never,
    serverName: "test-server",
  });

  await resolver(
    null,
    {
      commentId: "comment-1",
      modName: "",
      offset: "0",
      limit: "20",
      sort: "hot",
    },
    context,
    null as never
  );

  assertCommentRankingParams(mock.runCalls);
});
