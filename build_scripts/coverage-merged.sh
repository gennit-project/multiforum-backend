#!/usr/bin/env bash
#
# Merged unit + integration line coverage — the number Codecov reports by merging
# its `unit` and `integration` flag uploads, and what the README badge reflects.
#
# Runs both suites under c8 into one accumulated temp directory and emits
# coverage/lcov.info plus a text summary. Requires Docker (the integration suite
# uses Testcontainers Neo4j) and the generated type files (`npm run codegen`).
#
# CI runs the two suites as parallel jobs; this is the local, single-command,
# sequential equivalent. The inline `$(find ...)` form (rather than a variable)
# is deliberate — it ensures the file list is word-split into separate args.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "▶ unit suite (fresh coverage)…"
npx c8 --temp-directory=coverage/tmp --clean=true --reporter=lcov \
  node --loader ts-node/esm --test \
  $(find . -path './node_modules' -prune -o -path './ts_emitted' -prune -o -path './tests/integration' -prune -o -name '*test.ts' -print | sort)

echo "▶ integration suite (accumulating onto unit coverage)…"
TESTCONTAINERS_REUSE_ENABLE=true npx c8 --temp-directory=coverage/tmp --clean=false \
  --reporter=lcov --reporter=text-summary \
  node --loader ts-node/esm --test --test-concurrency=1 \
  $(find ./tests/integration -name '*test.ts' -print | sort)

echo "✔ merged coverage written to coverage/lcov.info"
