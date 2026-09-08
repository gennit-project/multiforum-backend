import test from "node:test";
import assert from "node:assert/strict";
import { Neo4jGraphQL } from "@neo4j/graphql";
import { isInputObjectType, isObjectType } from "graphql";
import typeDefs from "./typeDefs.js";

test("birthday is absent from generated read, filter, sort, and update surfaces", async () => {
  const schema = await new Neo4jGraphQL({ typeDefs }).getSchema();

  const user = schema.getType("User");
  assert.ok(isObjectType(user));
  assert.equal(user.getFields().dateOfBirth, undefined);

  for (const typeName of ["UserWhere", "UserSort", "UserUpdateInput"]) {
    const type = schema.getType(typeName);
    assert.ok(isInputObjectType(type), `${typeName} should be an input object`);
    assert.equal(type.getFields().dateOfBirth, undefined, `${typeName} leaked birthday`);
  }

  const createInput = schema.getType("UserCreateInput");
  assert.ok(isInputObjectType(createInput));
  assert.ok(createInput.getFields().dateOfBirth);
});
