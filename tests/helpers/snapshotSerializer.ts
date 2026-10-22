import {snapshot} from 'node:test';

// Preloaded via `node --import` ahead of every test process so that
// `t.assert.snapshot(...)` serialization is independent of Neo4j's incidental
// ordering.
//
// These snapshots replaced driver-vs-OGM `assert.deepEqual` parity checks. That
// comparison was robust to ordering because both sides were read in the SAME run
// — any run-to-run variation in Neo4j's row/key order affected both equally. A
// snapshot instead compares a value read now against a baseline committed from a
// different machine, so the same ordering variation that `deepEqual` absorbed
// now shows up as a spurious mismatch (observed: a developer's local database
// and CI return node property maps and multi-row reads in different orders).
//
// To make the snapshots as order-robust as the parity checks they replaced, the
// value is canonicalized before serialization: object keys are sorted, and
// arrays are sorted by the canonical form of their elements. The output is
// otherwise byte-for-byte the Node default (JSON.stringify(value, null, 2)).
// Canonical ordering means a snapshot no longer witnesses element/property
// order; tests that assert a specific order do so explicitly in the test body.
const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value
      .map(canonicalize)
      .map((item) => [JSON.stringify(item), item] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, item]) => item);
  }
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(source)
        .sort()
        .map((key) => [key, canonicalize(source[key])]),
    );
  }
  return value;
};

snapshot.setDefaultSnapshotSerializers([
  (value: unknown) => JSON.stringify(canonicalize(value), null, 2),
]);
