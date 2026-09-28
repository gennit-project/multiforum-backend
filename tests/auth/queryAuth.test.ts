import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import {
  extendSchema,
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
let ogm: ReturnType<typeof makeRequestContext>["ogm"];

const publicProfileAggregateFields = [
  "CommentsAggregate",
  "DiscussionsAggregate",
  "EventsAggregate",
  "ImagesAggregate",
  "AlbumsAggregate",
  "AuthoredWikiPageVersionsAggregate",
  "AdminOfChannelsAggregate",
  "ModOfChannelsAggregate",
] as const;

before(
  async () => {
    ({ schema, driver, ogm } = await buildPermissionedSchema({
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
        assert.ok(isObjectType(userType));

        transformedSchema.getQueryType()!.getFields().users.resolve = () => [
          {
            username: "public-user",
            ...Object.fromEntries(
              publicProfileAggregateFields.map((field) => [field, { count: 1 }])
            ),
          },
        ];
        for (const field of publicProfileAggregateFields) {
          userType.getFields()[field].resolve = (source) => source[field];
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
    contextValue: makeRequestContext({ driver, ogm }),
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
    contextValue: makeRequestContext({ driver, ogm }),
  });

  assert.deepEqual(result.errors, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)), {
    instanceSetupStatusPermissionProbe: { uploads: capability },
  });
});

test("public user profile aggregate counters are readable anonymously", async () => {
  const result = await graphql({
    schema,
    source: `
      query getPublicUserProfile($username: String!) {
        users(where: { username: $username }) {
          username
          CommentsAggregate(where: { NOT: { archived: true } }) { count }
          DiscussionsAggregate(
            where: { OR: [{ hasDownload: false }, { hasDownload: null }] }
          ) { count }
          DownloadsAggregate: DiscussionsAggregate(
            where: { hasDownload: true }
          ) { count }
          EventsAggregate { count }
          ImagesAggregate { count }
          AlbumsAggregate { count }
          AuthoredWikiPageVersionsAggregate { count }
          AdminOfChannelsAggregate { count }
          ModOfChannelsAggregate { count }
        }
      }
    `,
    variableValues: { username: "public-user" },
    contextValue: makeRequestContext({ driver, ogm }),
  });

  assert.deepEqual(result.errors, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)), {
    users: [
      {
        username: "public-user",
        CommentsAggregate: { count: 1 },
        DiscussionsAggregate: { count: 1 },
        DownloadsAggregate: { count: 1 },
        EventsAggregate: { count: 1 },
        ImagesAggregate: { count: 1 },
        AlbumsAggregate: { count: 1 },
        AuthoredWikiPageVersionsAggregate: { count: 1 },
        AdminOfChannelsAggregate: { count: 1 },
        ModOfChannelsAggregate: { count: 1 },
      },
    ],
  });
});

test("owner-only user aggregate counters remain private", async () => {
  const result = await graphql({
    schema,
    source: `
      query {
        users(where: { username: "public-user" }) {
          NotificationsAggregate { count }
        }
      }
    `,
    contextValue: makeRequestContext({ driver, ogm }),
  });

  assert.match(result.errors?.[0]?.message ?? "", /Not Authoris/i);
});
