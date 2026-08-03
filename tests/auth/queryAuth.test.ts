import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import {
  extendSchema,
  graphql,
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

before(
  async () => {
    ({ schema, driver, ogm } = await buildPermissionedSchema({
      transformSchema: (baseSchema) =>
        extendSchema(
          baseSchema,
          parse(`
            extend type Query {
              permissionFallbackProbe: User
            }

            extend type User {
              permissionFallbackProbe: String
            }
          `)
        ),
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
