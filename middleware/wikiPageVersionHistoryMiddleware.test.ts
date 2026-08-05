// Unit tests for the wiki-page version-history middleware. It wraps updateWikiPages
// three ways: pass through when there's no update; on a title/body edit, run the
// version-history handler (tested separately) before the resolver; and when the
// update creates child pages, run the resolver first and then seed each new child
// page's first TextVersion. These tests drive that branching, plus the child-page
// TextVersion creation/connection and its guards, with a stubbed resolver and a
// permissive in-memory OGM. No DB.
import assert from "node:assert/strict";
import test from "node:test";
import middleware from "./wikiPageVersionHistoryMiddleware.js";

const M: any = (middleware as any).Mutation;

// Permissive OGM. `log` records model.method calls so we can assert which writes
// happened. Per-model overrides let a test shape find/create/update results.
function makeCtx(models: Record<string, any> = {}) {
  const log: string[] = [];
  const ogm = {
    model(name: string) {
      const o = models[name] || {};
      return {
        find: async (...a: unknown[]) => {
          log.push(`${name}.find`);
          return o.find ? o.find(...a) : [];
        },
        create: async (...a: unknown[]) => {
          log.push(`${name}.create`);
          return o.create ? o.create(...a) : { [`${lower(name)}s`]: [{ id: `${name}-1` }] };
        },
        update: async (...a: unknown[]) => {
          log.push(`${name}.update`);
          return o.update ? o.update(...a) : {};
        },
      };
    },
  };
  return { ctx: { ogm, driver: {}, user: { username: "alice" } } as any, log };
}
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function countingResolve(result: unknown = { updateWikiPages: { wikiPages: [] } }) {
  const state = { calls: 0 };
  const resolve = async () => {
    state.calls += 1;
    return result;
  };
  return { resolve, state };
}

test("passes through to the resolver when there is no update", async () => {
  const { ctx, log } = makeCtx();
  const { resolve, state } = countingResolve();
  await M.updateWikiPages(resolve, null, { where: { id: "w-1" } }, ctx, {});
  assert.equal(state.calls, 1);
  assert.deepEqual(log, []); // no version handler, no writes
});

test("runs the version-history handler before the resolver on a title/body edit", async () => {
  const { ctx } = makeCtx();
  const { resolve, state } = countingResolve();
  await M.updateWikiPages(
    resolve,
    null,
    { where: { id: "w-1" }, update: { title: "New title", body: "New body" } },
    ctx,
    {}
  );
  // The handler runs (against the permissive OGM) and then the resolver is invoked.
  assert.equal(state.calls, 1);
});

test("update without title/body/child-pages just calls the resolver", async () => {
  const { ctx } = makeCtx();
  const { resolve, state } = countingResolve();
  await M.updateWikiPages(
    resolve,
    null,
    { where: { id: "w-1" }, update: { someOtherField: true } },
    ctx,
    {}
  );
  assert.equal(state.calls, 1);
});

test("child-page creation seeds a first TextVersion for each new child's title and body", async () => {
  const created = {
    updateWikiPages: {
      wikiPages: [
        {
          ChildPages: [
            { id: "child-1", title: "Child Title", body: "Child Body", editReason: "init" },
          ],
        },
      ],
    },
  };
  const { ctx, log } = makeCtx({
    TextVersion: { create: async () => ({ textVersions: [{ id: "tv-1" }] }) },
  });
  const { resolve, state } = countingResolve(created);
  const out = await M.updateWikiPages(
    resolve,
    null,
    { where: { id: "w-1" }, update: { ChildPages: { create: [{ node: {} }] } } },
    ctx,
    {}
  );
  assert.equal(state.calls, 1);
  assert.equal(out, created);
  // one TextVersion + WikiPage connect for the title, and again for the body
  assert.equal(log.filter((c) => c === "TextVersion.create").length, 2);
  assert.equal(log.filter((c) => c === "WikiPage.update").length, 2);
});

test("child-page creation with no wikiPages in the result is a no-op", async () => {
  const { ctx, log } = makeCtx();
  const { resolve } = countingResolve({ updateWikiPages: { wikiPages: [] } });
  await M.updateWikiPages(
    resolve,
    null,
    { where: { id: "w-1" }, update: { ChildPages: { create: [{ node: {} }] } } },
    ctx,
    {}
  );
  assert.ok(!log.includes("TextVersion.create"));
});

test("child pages with no title or body create no TextVersions", async () => {
  const created = {
    updateWikiPages: { wikiPages: [{ ChildPages: [{ id: "child-1" }] }] },
  };
  const { ctx, log } = makeCtx();
  const { resolve } = countingResolve(created);
  await M.updateWikiPages(
    resolve,
    null,
    { where: { id: "w-1" }, update: { ChildPages: { create: [{ node: {} }] } } },
    ctx,
    {}
  );
  assert.ok(!log.includes("TextVersion.create"));
});

test("a failed TextVersion creation is swallowed and does not break the update", async () => {
  const created = {
    updateWikiPages: { wikiPages: [{ ChildPages: [{ id: "child-1", title: "T" }] }] },
  };
  const { ctx } = makeCtx({
    TextVersion: {
      create: async () => {
        throw new Error("create boom");
      },
    },
  });
  const { resolve, state } = countingResolve(created);
  const out = await M.updateWikiPages(
    resolve,
    null,
    { where: { id: "w-1" }, update: { ChildPages: { create: [{ node: {} }] } } },
    ctx,
    {}
  );
  assert.equal(state.calls, 1);
  assert.equal(out, created); // error swallowed, result still returned
});

test("an empty TextVersion create result skips the WikiPage connect", async () => {
  const created = {
    updateWikiPages: { wikiPages: [{ ChildPages: [{ id: "child-1", title: "T" }] }] },
  };
  const { ctx, log } = makeCtx({
    TextVersion: { create: async () => ({ textVersions: [] }) },
  });
  const { resolve } = countingResolve(created);
  await M.updateWikiPages(
    resolve,
    null,
    { where: { id: "w-1" }, update: { ChildPages: { create: [{ node: {} }] } } },
    ctx,
    {}
  );
  assert.equal(log.filter((c) => c === "TextVersion.create").length, 1);
  assert.ok(!log.includes("WikiPage.update")); // no id to connect
});
