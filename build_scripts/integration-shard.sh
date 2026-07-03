#!/usr/bin/env bash
#
# Run one shard of the integration suite. The sorted integration test files are
# partitioned round-robin across SHARD_TOTAL shards, so each shard runs roughly
# 1/SHARD_TOTAL of them. CI runs the shards in parallel (a matrix job), each
# against its own Testcontainers Neo4j. Coverage (lcov) is written for this
# shard's subset; CI uploads each shard under the `integration` Codecov flag and
# Codecov unions them, so a line covered by any shard counts as covered.
#
# Env:
#   SHARD       1-based shard index   (default 1)
#   SHARD_TOTAL number of shards      (default 1 -> runs everything)
#
# Run via `pnpm run test:integration:shard` so node_modules/.bin (c8) is on PATH.
set -euo pipefail
cd "$(dirname "$0")/.."

SHARD="${SHARD:-1}"
SHARD_TOTAL="${SHARD_TOTAL:-1}"

# Round-robin: the file on line NR goes to shard ((NR-1) % SHARD_TOTAL) + 1.
list_files() {
  find ./tests/integration -name '*test.ts' -print | sort \
    | awk "NR % ${SHARD_TOTAL} == (${SHARD} - 1)"
}

if [ -z "$(list_files)" ]; then
  echo "Shard ${SHARD}/${SHARD_TOTAL}: no files assigned; nothing to run."
  exit 0
fi

echo "Shard ${SHARD}/${SHARD_TOTAL} running $(list_files | wc -l | tr -d ' ') file(s):"
list_files

# One Neo4j container per shard (reuse keeps the shard's files sharing it). The
# inline $(list_files) word-splits the newline-separated paths into args, the
# same way the other coverage scripts use $(find ...).
export TESTCONTAINERS_REUSE_ENABLE=true
c8 --reporter=lcov --reporter=text-summary \
  node --loader ts-node/esm --test --test-concurrency=1 $(list_files)
