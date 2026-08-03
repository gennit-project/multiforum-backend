#!/usr/bin/env bash
#
# Run one shard of the integration suite. Files are partitioned round-robin,
# with a small set of measured four-shard overrides to balance actual runtime.
# CI runs the shards in parallel (a matrix job), each against its own
# Testcontainers Neo4j. Coverage (lcov) is written for this shard's subset; CI
# uploads each shard under the `integration` Codecov flag and Codecov unions
# them, so a line covered by any shard counts as covered.
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
OVERRIDES_FILE="build_scripts/integration-shard-overrides.txt"

# Round-robin is the general rule, so newly added tests are always included.
# For the four-shard CI layout, apply the small timing-based override map.
list_files() {
  find ./tests/integration -name '*test.ts' -print | sort \
    | awk -v shard="${SHARD}" -v total="${SHARD_TOTAL}" '
        FNR == NR {
          if ($1 !~ /^#/ && NF == 2) overrides[$2] = $1
          next
        }
        {
          target = (FNR % total) + 1
          if (total == 4 && ($0 in overrides)) target = overrides[$0]
          if (target == shard) print
        }
      ' "${OVERRIDES_FILE}" -
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
export TS_NODE_TRANSPILE_ONLY=true
c8 --reporter=lcov --reporter=text-summary \
  node --loader ts-node/esm --test --test-concurrency=1 $(list_files)
