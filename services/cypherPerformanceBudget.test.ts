import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateProfile,
  renderPerformanceReport,
  summarizeProfile,
  type ProfileMetrics,
} from "./cypherPerformanceBudget.js";

test("summarizes an execution plan without depending on its shape", () => {
  const metrics = summarizeProfile(
    {
      operatorType: "ProduceResults",
      dbHits: 1,
      rows: 2,
      pageCacheHits: 3,
      children: [
        {
          operatorType: "NodeIndexSeek@neo4j",
          dbHits: 11,
          rows: 7,
          pageCacheHits: 5,
          pageCacheMisses: 2,
        },
        {
          operatorType: "Projection",
          dbHits: 0,
          rows: 4,
          children: [
            { operatorType: "Filter", dbHits: 6, rows: 3 },
          ],
        },
      ],
    },
    2
  );

  assert.deepEqual(metrics, {
    dbHits: 18,
    maxIntermediateRows: 7,
    resultCount: 2,
    pageCacheHits: 8,
    pageCacheMisses: 2,
    operators: ["Filter", "NodeIndexSeek", "ProduceResults", "Projection"],
  });
});

test("evaluates size-based budgets and forbidden operators", () => {
  const metrics: ProfileMetrics = {
    dbHits: 151,
    maxIntermediateRows: 41,
    resultCount: 20,
    pageCacheHits: 0,
    pageCacheMisses: 0,
    operators: ["AllNodesScan", "EagerAggregation", "NodeByLabelScan"],
  };

  const evaluation = evaluateProfile(metrics, {
    baseDbHits: 50,
    dbHitsPerRequestedRow: 5,
    baseIntermediateRows: 10,
    intermediateRowsPerRequestedRow: 1,
    requestedRows: 20,
    allowedOperators: ["NodeByLabelScan"],
  });

  assert.equal(evaluation.passed, false);
  assert.deepEqual(evaluation.violations, [
    "db hits 151 exceed budget 150",
    "max intermediate rows 41 exceed budget 30",
    "forbidden operators present: AllNodesScan",
  ]);
  assert.equal(evaluation.maxDbHits, 150);
  assert.equal(evaluation.maxIntermediateRows, 30);
});

test("renders a readable markdown report", () => {
  const report = renderPerformanceReport(
    "2026-10-14T00:00:00.000Z",
    { discussions: 2_000, comments: 20_000 },
    [
      {
        name: "comment-page",
        description: "Root comment page",
        requestedRows: 20,
        cold: {
          dbHits: 300,
          maxIntermediateRows: 30,
          resultCount: 20,
          pageCacheHits: 0,
          pageCacheMisses: 10,
          operators: [],
        },
        warm: {
          dbHits: 250,
          maxIntermediateRows: 20,
          resultCount: 20,
          pageCacheHits: 10,
          pageCacheMisses: 0,
          operators: [],
        },
        evaluation: {
          passed: true,
          maxDbHits: 400,
          maxIntermediateRows: 50,
          violations: [],
        },
      },
    ]
  );

  assert.match(report, /discussions=2000, comments=20000/);
  assert.match(report, /\| comment-page \| 20 \| 300 \| 250\/400/);
  assert.match(report, /\| PASS \|/);
});
