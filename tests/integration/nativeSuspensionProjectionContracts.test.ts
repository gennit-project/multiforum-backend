import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Driver } from "neo4j-driver";
import type { ServerSuspensionCore } from "../../customResolvers/contracts/serverSuspensionSource.js";
import { USER_SUSPENSION_QUERY, MOD_SUSPENSION_QUERY } from "../../rules/permission/getActiveServerSuspension.js";
import { USER_CHANNEL_SUSPENSION_QUERY, MOD_CHANNEL_SUSPENSION_QUERY } from "../../services/persistence/channelPermissionRepository.js";
import { PERMISSION_SERVER_CONFIG_QUERY } from "../../services/persistence/permissionServerConfigRepository.js";
import { startNeo4j, resetDatabase, stopNeo4j } from "./neo4jHarness.js";
let driver: Driver;
before(async () => {
  driver = await startNeo4j();
  await resetDatabase(driver);
  await driver.executeQuery(`CREATE(s:ServerConfig{serverName:'server'}),(ch:Channel{uniqueName:'forum'}),
    (u:User{username:'alice'}),(m:ModerationProfile{displayName:'Mod A'}),
    (su:Suspension{id:'su',username:'alice'}),(sm:Suspension{id:'sm',modProfileName:'Mod A'}),
    (i:Issue{id:'issue',issueNumber:1})
    CREATE(s)-[:SUSPENDED_AS_USER]->(su),(s)-[:SUSPENDED_AS_MOD]->(sm),
      (ch)-[:SUSPENDED_AS_USER]->(su),(ch)-[:SUSPENDED_AS_MOD]->(sm),
      (u)-[:SUSPENDED_AS_USER]->(su),(m)-[:SUSPENDED_AS_MOD]->(sm),
      (su)-[:HAS_CONTEXT]->(i),(sm)-[:HAS_CONTEXT]->(i)`);
}, {timeout:240000});
after(async () => stopNeo4j());
const core = {
  id:true, username:true, modProfileName:true, channelUniqueName:true, serverName:true,
  suspendedUntil:true, suspendedIndefinitely:true, RelatedIssue:true,
} satisfies Record<keyof ServerSuspensionCore, true>;
function keys(value: unknown): string[] {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return Object.keys(value).sort();
}
for (const [name,query,member,scope] of [
  ["server user",USER_SUSPENSION_QUERY,"SuspendedUser","server"],
  ["server moderator",MOD_SUSPENSION_QUERY,"SuspendedMod","server"],
  ["channel user",USER_CHANNEL_SUSPENSION_QUERY,"SuspendedUser","channel"],
  ["channel moderator",MOD_CHANNEL_SUSPENSION_QUERY,"SuspendedMod","channel"],
] as const) {
  test(`${name}: actual native query matches its source projection including nullable keys`, async () => {
    const rows = (await driver.executeQuery(query,{serverName:"server",channelUniqueName:"forum",username:"alice",modProfileName:"Mod A"})).records;
    assert.equal(rows.length,1);
    const source = rows[0].get("suspension");
    const fields = Object.keys(core).filter(key => scope === "server" || !["serverName","channelUniqueName"].includes(key));
    assert.deepEqual(keys(source), [...fields,member].sort());
    assert.deepEqual(keys(source.RelatedIssue), ["id","issueNumber"]);
    assert.deepEqual(keys(source[member]), [member === "SuspendedUser" ? "username" : "displayName"]);
    assert.equal(source.suspendedUntil,null);
    assert.equal(source.suspendedIndefinitely,null);
  });
}
test("server configuration native suspension lists match their distinct source projection", async () => {
  const result = await driver.executeQuery(PERMISSION_SERVER_CONFIG_QUERY,{serverName:"server"});
  const config = result.records[0].get("serverConfig");
  const expected = Object.keys(core).filter(key=>key!=="channelUniqueName").sort();
  for (const field of ["SuspendedUsers","SuspendedMods"]) {
    assert.equal(config[field].length,1);
    assert.deepEqual(keys(config[field][0]),expected);
    assert.deepEqual(keys(config[field][0].RelatedIssue),["id","issueNumber"]);
  }
});
