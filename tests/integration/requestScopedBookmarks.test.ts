import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import neo4j, { type Driver } from "neo4j-driver";
import {
  getRequestBookmarkManager,
  installRequestScopedBookmarks,
  runWithRequestBookmarks,
} from "../../services/requestScopedBookmarks.js";
import {
  resetDatabase,
  startNeo4j,
  stopNeo4j,
} from "./neo4jHarness.js";

let driver: Driver;

before(async () => {
  driver = installRequestScopedBookmarks(await startNeo4j());
}, { timeout: 240000 });

after(async () => {
  await stopNeo4j();
});

beforeEach(async () => {
  await resetDatabase(driver);
});

test("a routed read immediately observes a write from the same request", async () => {
  await runWithRequestBookmarks(async () => {
    const writeSession = driver.session({
      defaultAccessMode: neo4j.session.WRITE,
    });
    try {
      await writeSession.executeWrite((tx) =>
        tx.run("CREATE (:BookmarkProbe { id: $id })", { id: "probe-1" })
      );
    } finally {
      await writeSession.close();
    }

    const bookmarks = await getRequestBookmarkManager()?.getBookmarks();
    assert.ok(bookmarks);
    assert.ok(Array.from(bookmarks).length > 0);

    const readSession = driver.session({
      defaultAccessMode: neo4j.session.READ,
    });
    try {
      const result = await readSession.executeRead((tx) =>
        tx.run(
          "MATCH (probe:BookmarkProbe { id: $id }) RETURN probe.id AS id",
          { id: "probe-1" }
        )
      );
      assert.equal(result.records[0]?.get("id"), "probe-1");
    } finally {
      await readSession.close();
    }
  });
});
