import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildSchema, extendSchema, parse } from "graphql";
import { compareSchemas, readOperations, readSupportList } from "../../build_scripts/frontendCompatibility.js";

// Run after schema:compatibility: these are verified exact-revision data inputs,
// never frontend executable code or a network request from the unit suite.
for (const client of readSupportList(readFileSync("graphql-compatibility/supported-frontends.json", "utf8"))) {
  const directory = `artifacts/frontend-compatibility/${client.revision}`;
  const contract = readOperations(readFileSync(`${directory}/operations.json`, "utf8"), client);
  const sdl = readFileSync(`${directory}/schema.graphql`, "utf8");
  const baseline = buildSchema(sdl);
  test(`${client.revision}: all production operations accept an additive schema`, () => {
    assert.equal(compareSchemas(extendSchema(baseline, parse("extend type Query { compatibilityProbe: String }")), baseline, contract).compatible, true);
  });
  test(`${client.revision}: wiki removal rejects actual frontend documents`, () => {
    const changed = buildSchema(sdl);
    delete changed.getMutationType()!.getFields().writeWikiPage;
    const result = compareSchemas(changed, baseline, contract);
    assert.equal(result.compatible, false);
    assert.ok(result.diagnostics.some((d) => d.message.includes("writeWikiPage") && d.file && d.line));
  });
  test(`${client.revision}: old issue input rejects migrated frontend`, () => {
    const changed = buildSchema(sdl.replace("createIssue(input: SubmitIssueInput!", "createIssue(input: IssueCreateInput!"));
    const result = compareSchemas(changed, baseline, contract);
    assert.equal(result.compatible, false);
    assert.ok(result.diagnostics.some((d) => d.message.includes("IssueCreateInput") && d.message.includes("SubmitIssueInput")));
  });
  test(`${client.revision}: removed album argument rejects migrated frontend`, () => {
    const changed = buildSchema(sdl);
    const field = changed.getMutationType()!.getFields().updateDiscussionWithChannelConnections;
    field.args = field.args.filter((arg) => arg.name !== "album");
    const result = compareSchemas(changed, baseline, contract);
    assert.equal(result.compatible, false);
    assert.ok(result.diagnostics.some((d) => d.message.includes("album")));
  });
}
