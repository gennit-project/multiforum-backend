import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import {
  extendSchema,
  getNamedType,
  graphql,
  isObjectType,
  parse,
  type GraphQLSchema,
} from "graphql";
import type { Driver } from "neo4j-driver";
import {
  buildPermissionedSchema,
  makeRequestContext,
} from "../helpers/buildPermissionedSchema.js";

let schema: GraphQLSchema;
let driver: Driver;

// @neo4j/graphql v7 removed the per-node `<Rel>Aggregate` fields (v5 shape).
// The related-node counter now lives on the generated `<Rel>Connection` type as
// `totalCount` (reachable anonymously via the generatedTypeRules wildcard in
// permissions.ts). These are the public-profile relationship connections whose
// counters must stay readable without authentication.
const publicProfileConnectionFields = [
  "CommentsConnection",
  "DiscussionsConnection",
  "EventsConnection",
  "ImagesConnection",
  "AlbumsConnection",
  "AuthoredWikiPageVersionsConnection",
  "AdminOfChannelsConnection",
  "ModOfChannelsConnection",
] as const;

before(
  async () => {
    ({ schema, driver } = await buildPermissionedSchema({
      transformSchema: (baseSchema) => {
        const transformedSchema = extendSchema(
          baseSchema,
          parse(`
            extend type Query {
              permissionFallbackProbe: User
              instanceSetupStatusPermissionProbe: InstanceSetupStatus
            }

            extend type User {
              permissionFallbackProbe: String
            }
          `)
        );
        const userType = transformedSchema.getType("User");
        const queryFields = transformedSchema.getQueryType()!.getFields();
        assert.ok(isObjectType(userType));

        queryFields.users.resolve = () => [
          {
            username: "public-user",
            NotificationsConnection: { totalCount: 0 },
            ...Object.fromEntries(
              publicProfileConnectionFields.map((field) => [
                field,
                { totalCount: 1 },
              ])
            ),
          },
        ];
        queryFields.getSiteWideDiscussionList.resolve = () => ({
          aggregateDiscussionCount: 1,
          discussions: [],
          pageInfo: {
            endCursor: "discussion-cursor",
            hasNextPage: true,
          },
        });
        // Mock each relationship connection (and its generated totalCount
        // resolver) to a plain source read so the deny/allow decision is the
        // only thing under test — the real resolvers would otherwise hit Neo4j.
        for (const field of [
          ...publicProfileConnectionFields,
          "NotificationsConnection",
        ]) {
          const connField = userType.getFields()[field];
          connField.resolve = (source) => source[field];
          const connType = getNamedType(connField.type);
          if (isObjectType(connType)) {
            connType.getFields().totalCount.resolve = (source) =>
              source.totalCount;
          }
        }

        return transformedSchema;
      },
    }));
  },
  { timeout: 120000 }
);

after(async () => {
  await driver.close();
});

test("an unruled field is denied by the shield fallback", async () => {
  const result = await graphql({
    schema,
    source: `
      query {
        permissionFallbackProbe {
          permissionFallbackProbe
        }
      }
    `,
    rootValue: {
      permissionFallbackProbe: {
        permissionFallbackProbe: "must not escape",
      },
    },
    contextValue: makeRequestContext({ driver }),
  });

  assert.match(result.errors?.[0]?.message ?? "", /Not Authoris/i);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)), {
    permissionFallbackProbe: { permissionFallbackProbe: null },
  });
});

test("instance setup status fields are publicly readable", async () => {
  const capability = {
    configured: true,
    enabled: true,
    requiredEnvVarsMissing: [],
    setupUrl: "/admin/setup#file-uploads",
    docsPath: "/roles/admins/image-hosting",
  };
  const result = await graphql({
    schema,
    source: `
      query {
        instanceSetupStatusPermissionProbe {
          uploads {
            configured
            enabled
            requiredEnvVarsMissing
            setupUrl
            docsPath
          }
        }
      }
    `,
    rootValue: {
      instanceSetupStatusPermissionProbe: {
        uploads: capability,
      },
    },
    contextValue: makeRequestContext({ driver }),
  });

  assert.deepEqual(result.errors, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)), {
    instanceSetupStatusPermissionProbe: { uploads: capability },
  });
});

test("sitewide discussion pagination metadata is publicly readable", async () => {
  const result = await graphql({
    schema,
    source: `
      query {
        getSiteWideDiscussionList {
          pageInfo {
            endCursor
            hasNextPage
          }
        }
      }
    `,
    contextValue: makeRequestContext({ driver }),
  });

  assert.deepEqual(result.errors, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)), {
    getSiteWideDiscussionList: {
      pageInfo: {
        endCursor: "discussion-cursor",
        hasNextPage: true,
      },
    },
  });
});

test("public user profile aggregate counters are readable anonymously", async () => {
  const result = await graphql({
    schema,
    source: `
      query getPublicUserProfile($username: String!) {
        users(where: { username: { eq: $username } }) {
          username
          CommentsConnection { totalCount }
          DiscussionsConnection { totalCount }
          EventsConnection { totalCount }
          ImagesConnection { totalCount }
          AlbumsConnection { totalCount }
          AuthoredWikiPageVersionsConnection { totalCount }
          AdminOfChannelsConnection { totalCount }
          ModOfChannelsConnection { totalCount }
        }
      }
    `,
    variableValues: { username: "public-user" },
    contextValue: makeRequestContext({ driver }),
  });

  assert.deepEqual(result.errors, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)), {
    users: [
      {
        username: "public-user",
        CommentsConnection: { totalCount: 1 },
        DiscussionsConnection: { totalCount: 1 },
        EventsConnection: { totalCount: 1 },
        ImagesConnection: { totalCount: 1 },
        AlbumsConnection: { totalCount: 1 },
        AuthoredWikiPageVersionsConnection: { totalCount: 1 },
        AdminOfChannelsConnection: { totalCount: 1 },
        ModOfChannelsConnection: { totalCount: 1 },
      },
    ],
  });
});

test("notification aggregate traversal delegates ownership filtering to Neo4j GraphQL", async () => {
  const result = await graphql({
    schema,
    source: `
      query {
        users(where: { username: { eq: "public-user" } }) {
          NotificationsConnection { totalCount }
        }
      }
    `,
    contextValue: makeRequestContext({ driver }),
  });

  assert.deepEqual(result.errors, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)), {
    users: [{ NotificationsConnection: { totalCount: 0 } }],
  });
});
