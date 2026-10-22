#!/usr/bin/env bash
#
# Run one shard of the integration suite. Files are partitioned across shards by
# a longest-processing-time (LPT) bin-packing pass over measured per-file
# runtimes, so every shard carries roughly equal wall-clock and the matrix
# critical path is ~= total suite time / shard count. CI runs the shards in
# parallel (a matrix job), each against its own Testcontainers Neo4j. Coverage
# (lcov) is written for this shard's subset; CI uploads each shard under the
# `integration` Codecov flag and Codecov unions them, so a line covered by any
# shard counts as covered.
#
# The assignment is computed identically and deterministically by every shard
# job (same file list + same timings + same algorithm), then each job keeps the
# files assigned to its own index. Timings come from the manifest below; files
# not listed there fall back to the mean measured time, so newly added tests are
# still distributed evenly until the manifest is refreshed. With no manifest at
# all, every file weighs the same and LPT degrades gracefully to an even
# by-count split.
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
TIMINGS_FILE="build_scripts/integration-shard-timings.txt"

# Emit "<shard-index>\t<file>" for every integration test file, assigning each
# to a shard via LPT bin-packing. Sorting is forced to the C locale so the
# descending-time / filename-tiebreak order — and therefore the whole
# assignment — is byte-for-byte identical on every runner.
assign_files() {
  find ./tests/integration -name '*test.ts' -print \
    | LC_ALL=C awk -v tf="${TIMINGS_FILE}" '
        BEGIN {
          n = 0; sum = 0;
          while ((getline line < tf) > 0) {
            if (line ~ /^[[:space:]]*#/ || line ~ /^[[:space:]]*$/) continue
            split(line, a, /[[:space:]]+/)
            # a[1] = seconds, a[2] = path (integration paths never contain spaces)
            t[a[2]] = a[1]; sum += a[1]; n++
          }
          def = (n > 0) ? sum / n : 1
        }
        { secs = ($0 in t) ? t[$0] : def; printf "%d\t%s\n", secs, $0 }
      ' \
    | LC_ALL=C sort -k1,1nr -k2,2 \
    | LC_ALL=C awk -v total="${SHARD_TOTAL}" '
        {
          # Place this file on the currently least-loaded shard (lowest index
          # wins ties), the standard LPT greedy step.
          best = 1
          for (j = 2; j <= total; j++) if (load[j] < load[best]) best = j
          load[best] += $1
          print best "\t" $2
        }
      '
}

# This shard's files, back in filename order for stable, readable CI logs.
list_files() {
  assign_files | LC_ALL=C awk -v shard="${SHARD}" -F'\t' '$1 == shard { print $2 }' \
    | LC_ALL=C sort
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
c8 --all=false --exclude-after-remap \
  --exclude='rules/permission/userDataHelperFunctions.ts' \
  --reporter=lcov --reporter=text-summary \
  node --import tsx --test --test-concurrency=1 $(list_files)
