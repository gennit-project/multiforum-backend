import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAdminOverride } from "./serverAdminOverride.js";

// The server-admin/root override that owner & channel rules use. Root always
// passes; a server admin passes unless server-suspended; everyone else fails.
// See docs/isadmin-phaseout-design.md.

test("evaluateAdminOverride: root always passes, even when suspended", () => {
  assert.equal(
    evaluateAdminOverride({ isRoot: true, isServerAdmin: false, isServerSuspended: true }),
    true
  );
  assert.equal(
    evaluateAdminOverride({ isRoot: true, isServerAdmin: true, isServerSuspended: true }),
    true
  );
});

test("evaluateAdminOverride: an un-suspended server admin passes", () => {
  assert.equal(
    evaluateAdminOverride({ isRoot: false, isServerAdmin: true, isServerSuspended: false }),
    true
  );
});

test("evaluateAdminOverride: a server-suspended admin loses the override", () => {
  assert.equal(
    evaluateAdminOverride({ isRoot: false, isServerAdmin: true, isServerSuspended: true }),
    false
  );
});

test("evaluateAdminOverride: a non-admin never passes via the override", () => {
  assert.equal(
    evaluateAdminOverride({ isRoot: false, isServerAdmin: false, isServerSuspended: false }),
    false
  );
});
